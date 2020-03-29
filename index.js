const iohook = require("iohook");
const robot = require("robotjs");
const { createWorker } = require("tesseract.js");
const Jimp = require("jimp");
const fuzzyset = require("fuzzyset.js");
const key = require("./key.json");
const readline = require("readline");
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

console.clear();
console.log("Welcome to the KI Trivia Bot! Please go to the 'Wizard101 Adventuring' trivia first. Make sure all elements of the quiz are in full view. When ready hit enter.");

const worker = createWorker({
	logger: m => console.log(m)
});
rl.once("line", async () => {
	await worker.load();
	await worker.loadLanguage("eng");
	await worker.initialize("eng");
	await getPositions();

	for(let i = 0; i < 10; i++) {
		console.log(`\nLogin and complete captcha if needed. Please go to ${key.triviaOrder[i]}. Do not touch your device while the the trivia is being answered. Press enter when ready.`);
		await answerTrivia(i);
	}
});

function answerTrivia(i) {
	return new Promise(resolve => {
		rl.once("line", async () => {
			for(let j = 0; j < 12; j++) {
				let answer = await getAnswer(key[key.triviaOrder[i]]);
				robot.moveMouse(positions[answer.answer].x, positions[answer.answer].y + answer.y);
				robot.mouseClick("left");

				let addY = await available(positions.button.x, positions.button.y);
				robot.moveMouse(positions.button.x, positions.button.y + addY);
				robot.mouseClick("left");
				await sleep(1000);
			}
			console.log(`Finished ${key.triviaOrder[i]}`);
			resolve();
		});
	});
}

/*
The user is in charge of determining where the bot will click. This method should work fine to ensure this works with every size of screen.
TODO: Use Robot.js' getPixelColor method to make sure the user doesn't miss click. Checking for the green color of the checkmarks should work if we use the same looping method we do on the button.

let positions = {
	"topLeft": {x: x-coord, y: y-coord}
	"topRight": {x: x-coord, y: y-coord}
	"bottomLeft": {x: x-coord, y: y-coord}
	"bottomRight": {x: x-coord, y: y-coord}
	"button" ("Next Question!" button): {x: x-coord, y: y-coord}
}
*/
let scale;
let positions = {};
function getPositions() {
	return new Promise(resolve => {
		iohook.start();
		console.log("Please select the top-left answer choice.");

		iohook.on("mouseclick", () => {
			if(!positions.topLeft) {
				positions.topLeft = robot.getMousePos();
				console.log("Please select the top-right answer choice.");
			} else if(!positions.topRight) {
				iohook.stop();
				positions.topRight = robot.getMousePos();
				// Find the scale based on the distance between the top right and top left answer choices to find the locations of everything else.
				scale = Math.round((positions.topRight.x - positions.topLeft.x) / 10); //	I did a thing

				positions.bottomLeft = { x: positions.topLeft.x, y: positions.topLeft.y + scale };
				positions.bottomRight = { x: positions.topRight.x, y: positions.topRight.y + scale };
				positions.button = { x: positions.topRight.x, y: positions.topRight.y + 2 * scale };

				resolve();
			}
		});
	});
}
/*
I hope I don't have to read this in the distant future, or anyone for that matter.

We're going to capture it, crop out the specific area we need using the scale and robot.js, convert from raw to a png buffer,
feed the buffer into tessereact to convert it to usable text, then use fuzzset.js because we're going to assume tesseract is never perfect.
This is done in getAnswerChoiceText() for the answer choices.
*/
async function getAnswer(trivia) {
	const questionBuffer = await convertToBuffer(robot.screen.capture(positions.topLeft.x - (scale * 2.1), positions.topLeft.y - (scale * 1.5), scale * 22.25, scale / 1.2));
	const { data: { text } } = await worker.recognize(questionBuffer);
	let question = fuzzyset(Object.keys(trivia)).get(text.replace(/\r\n|\n|\r/gm, ""));
	if(!question) {
		console.log(`Unkown question: ${text.replace(/\r\n|\n|\r/gm, "")}\nMake sure you're on the correct trivia. If you are, please report this.`);
		return { "answer": key.choiceOrder[0], "y": positions.topLeft.y };
	} else {
		question = question[0][1];
	}

	let answers = [];
	let answerChoiceText;
	for(let i = 0; i < 4; i++) {
		answerChoiceText = await getAnswerChoiceText(key.choiceOrder[i]);
		if(answerChoiceText.text === trivia[question]) {
			return { "answer": key.choiceOrder[i], "y": answerChoiceText.y };
		} else {
			answers.push(answerChoiceText.text);
		}
	}

	let answerIndex = fuzzyset(answers).get(trivia[question]);
	if(answerIndex) {
		answerIndex = answers.indexOf(answerIndex[0][1]);
		if(answerIndex !== -1) return { "answer": key.choiceOrder[answerIndex], "y": answerChoiceText.y };
	}

	return { "answer": key.choiceOrder[0], "y": answerChoiceText.y };
}

async function getAnswerChoiceText(pos) {
	const y = await available(positions[pos].x, positions[pos].y);
	const answerChoiceBuffer = await convertToBuffer(robot.screen.capture(positions[pos].x + (scale / 3), positions[pos].y - (scale / 2), scale * 9, scale));
	const { data: { text } } = await worker.recognize(answerChoiceBuffer);
	return { "text": text.replace(/\r\n|\n|\r/gm, ""), "y": y };
}

//	Convert the raw binary buffer from robot.js to a png buffer.
function convertToBuffer(input) {
	return new Promise(resolve => {
		// eslint-disable-next-line no-new
		new Jimp({ data: input.image, width: input.width, height: input.height }, async (error, image) => {
			if(error) throw error.stack;
			let output = await image.getBufferAsync(Jimp.MIME_PNG);
			resolve(output);
		});
	});
}

/*
Resolve promise if the item appears (the color is not white). Since we don't know exactly where it is, we're going to loop through the y axis.

While debugging it was found that the location of buttons were not always the same due to the length of text in the answer choices.
Now this function returns the location of where it was found as well to combat this.
This really only hits the edges of buttons; fine for its original purpose, but not really its new found one.
We also have to pass this all the way up to answerTrivia though, creating a bunch of objects in the process. Maybe we can make a better solution in the future.
*/
function available(x, y) {
	return new Promise(resolve => {
		for(let p = 1; p <= scale / 2 + 1; p++) {
			if(robot.getPixelColor(x, y + p)[0] !== "f") {
				resolve(p);
				break;
			} else if(p > scale / 2 - 1) {
				p = 1;
			}
		}
	});
}

function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

process.on("unhandledRejection", error => {
	console.log("unhandledRejection", error.stack);
});

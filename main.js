const fs = require('fs');
const path = require('path');
const chrome = require('selenium-webdriver/chrome');
const { Builder, By } = require('selenium-webdriver');

// This script monitors farcaster mentions, and 
// 'quote casts' the parent with a keycat video.

const fid = 974102; // @playemoff
const hub = 'https://nemes.farcaster.xyz:2281';
const timestampFile = path.join(__dirname, 'last-timestamp');

async function main() {

  // Start a browser
  const options = new chrome.Options();
  options.addArguments(`--user-data-dir=${path.join(__dirname, 'chrome')}`);
  const driver = await new Builder().setChromeOptions(options).build();

  // Periodically check mentions
  while (true) {
    for (const message of await checkMentions()) {
      await processMessage(message, driver);
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
}

async function checkMentions() {
  console.log('Checking mentions...');

  const messages = [];
  const lastTimestamp = parseInt(fs.readFileSync(timestampFile, 'utf8'));

  // Page through mentions from newest to oldest
  let pageToken;
  loop: do {

    const response = await fetch(
      `${hub}/v1/castsByMention?fid=${fid}&reverse=1${pageToken ? `&pageToken=${pageToken}` : ''}`
    );

    if (!response.ok) {
      throw new Error(`Error checking mentions: ${response.status}, ${await response.text()}`);
    }
  
    const mentions = await response.json();
  
    for (const message of mentions.messages) {
      if (message.data.timestamp <= lastTimestamp) {
        // We've reached all the unprocessed messages
        break loop;
      } else if (message.data.castAddBody.parentCastId) {
        // Only process messages that are replies
        messages.unshift(message);
      }
    }

    pageToken = mentions.nextPageToken;
  } while (pageToken)

  // Return unprocessed messages from oldest to newest
  return messages;
}

async function processMessage(message, driver) {

  const parent = message.data.castAddBody.parentCastId;
  console.log(`Processing message ${parent.hash} from ${parent.fid}...`);

  // Lookup the cast's username
  const response = await fetch(`${hub}/v1/userDataByFid?fid=${parent.fid}`);
  if (!response.ok) {
    throw new Error(`Error fetching username: ${response.status}, ${await response.text()}`);
  }

  const username = (await response.json()).messages.find(
    m => m.data.userDataBody.type === 'USER_DATA_TYPE_USERNAME'
  )?.data.userDataBody.value;

  // Send a quote cast
  if (username) {
    await cast(driver, username, parent.hash.slice(0,10));
  }

  // Checkpoint our progress
  fs.writeFileSync(timestampFile, `${message.data.timestamp}`);
}

async function cast(driver, username, hash) {

  // Go to warpcast
  await driver.get('https://warpcast.com');
  await driver.sleep(3000);

  // Start a cast
  const castButton = await driver.findElement(By.xpath('//button[text()="Cast"]'));
  await castButton.click();
  await driver.sleep(1000);

  // Type the URL we're quoting
  const actions = driver.actions();
  await actions.sendKeys(`https://warpcast.com/${username}/${hash}`).perform();
  await driver.sleep(500);

  // Upload the video
  const fileInput = await driver.findElement(By.css('input[type="file"]'));
  await fileInput.sendKeys(path.join(__dirname, 'keycat.webm'));
  await driver.sleep(500);

  // Wait for the upload to process
  const submitButton = await driver.findElement(By.css('button[title="Cast"]'));
  await driver.wait(async () => !(await submitButton.getAttribute('disabled')), 60000);

  // Submit the cast
  await submitButton.click();
  await driver.sleep(3000);
}

main().catch(e => { console.error(e); process.exitCode = 1; });

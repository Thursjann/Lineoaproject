require('dotenv').config();
const line = require('@line/bot-sdk');
const axios = require('axios');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

if (!config.channelAccessToken || config.channelAccessToken === 'YOUR_CHANNEL_ACCESS_TOKEN') {
  console.error('❌ Error: LINE_CHANNEL_ACCESS_TOKEN is not configured in .env.');
  process.exit(1);
}

const client = new line.Client(config);
const liffId = process.env.LIFF_ID || 'YOUR_LIFF_ID';
const liffUrl = `https://liff.line.me/${liffId}`;

const richMenuConfig = {
  size: {
    width: 2500,
    height: 1686
  },
  selected: true,
  name: "Laundry Service Rich Menu",
  chatBarText: "เมนูหลักซักรีด 🧺",
  areas: [
    {
      bounds: { x: 0, y: 0, width: 1250, height: 843 },
      action: {
        type: "uri",
        label: "เรียกรับผ้า/จองคิว",
        uri: liffUrl
      }
    },
    {
      bounds: { x: 1250, y: 0, width: 1250, height: 843 },
      action: {
        type: "message",
        label: "เช็คสถานะ",
        text: "เช็คสถานะ"
      }
    },
    {
      bounds: { x: 0, y: 843, width: 1250, height: 843 },
      action: {
        type: "uri",
        label: "ดูราคา/โปรโมชั่น",
        uri: `${liffUrl}?tab=rates`
      }
    },
    {
      bounds: { x: 1250, y: 843, width: 1250, height: 843 },
      action: {
        type: "message",
        label: "ติดต่อพนักงาน",
        text: "ติดต่อพนักงาน"
      }
    }
  ]
};

async function setupRichMenu() {
  try {
    console.log('1. Creating Rich Menu layout...');
    const richMenuId = await client.createRichMenu(richMenuConfig);
    console.log(`✅ Rich Menu layout created with ID: ${richMenuId}`);

    console.log('2. Fetching default laundry Rich Menu graphic...');
    // Fetch a generic laundry rich menu layout image buffer
    const imageUrl = 'https://images.unsplash.com/photo-1545173168-9f1947eebd01?auto=format&fit=crop&w=2500&h=1686&q=80';
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(imageResponse.data, 'binary');

    console.log('3. Uploading background image...');
    await client.setRichMenuImage(richMenuId, buffer, 'image/jpeg');
    console.log('✅ Background image uploaded successfully.');

    console.log('4. Setting as default Rich Menu...');
    await client.setDefaultRichMenu(richMenuId);
    console.log('🎉 Setup Complete! Default Rich Menu set successfully.');
  } catch (error) {
    console.error('❌ Failed to set up Rich Menu:', error.message || error);
    if (error.originalError && error.originalError.response) {
      console.error('LINE Response Error:', JSON.stringify(error.originalError.response.data, null, 2));
    }
  }
}

setupRichMenu();

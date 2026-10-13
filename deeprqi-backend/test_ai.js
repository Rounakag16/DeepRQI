require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { handleMessage } = require('./src/lib/chatbot');

async function main() {
  const img = await prisma.roadImage.findFirst({ include: { road: true } });
  
  if (!img) {
    console.log("No images found in database.");
    return;
  }

  console.log(`Using contextPath: /results/${img.id} for road: ${img.road.roadName}`);

  // Test the exact question that failed earlier
  const question = "What is the RQI for this inspection?";
  console.log(`\nUser: ${question}`);
  
  try {
    const response = await handleMessage(question, { role: "INSPECTOR", id: "test" }, [], `/results/${img.id}`);
    console.log(`\nAI Response:\n${response}`);
  } catch (err) {
    console.error("AI Error:", err);
  }
}

main().finally(() => prisma.$disconnect());

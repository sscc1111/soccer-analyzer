import { VertexAI } from "@google-cloud/vertexai";

async function testVertexAI() {
  const projectId = process.env.GCP_PROJECT_ID;
  if (!projectId) throw new Error("GCP_PROJECT_ID not set");

  console.log(`Testing Vertex AI with project: ${projectId}`);
  
  const vertexAI = new VertexAI({ 
    project: projectId, 
    location: "us-central1" 
  });
  
  const model = vertexAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  });

  console.log("Sending test request...");
  
  const result = await model.generateContent({
    contents: [{ 
      role: "user", 
      parts: [{ text: 'Return JSON only: {"status": "ok", "message": "Vertex AI works!"}' }] 
    }],
  });

  const response = result.response;
  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  
  console.log("Response:", text);
  return text;
}

testVertexAI()
  .then(() => console.log("✅ Test passed!"))
  .catch((err) => console.error("❌ Test failed:", err.message));

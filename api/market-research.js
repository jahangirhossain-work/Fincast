// Vercel Serverless Function (Node.js) to handle Gemini API calls securely

export default async function handler(request, response) {
    // 1. Check if it's a POST request
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed' });
    }

    // 2. Get the user query from the request body
    const { userQuery } = request.body;
    if (!userQuery) {
        return response.status(400).json({ error: 'Missing userQuery in request body' });
    }

    // 3. Get the API Key securely from Vercel Environment Variables
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error("GEMINI_API_KEY environment variable not set!");
        return response.status(500).json({ error: 'API key configuration error on server.' });
    }

    // 4. Prepare the API call to Gemini (similar to before, but on the server)
    const systemPrompt = "Act as an expert market research analyst specializing in the Saudi Arabia and GCC region. Provide a concise, insightful analysis based on the user's query using the most current information available. Focus on key trends, opportunities, challenges, and potential market size where applicable. Structure the response clearly using markdown for readability (headings, lists). If citing sources, ensure they are relevant.";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }], // Enable Google Search grounding
        systemInstruction: {
            parts: [{ text: systemPrompt }]
        },
    };

    try {
        // 5. Make the API call using fetch (Node.js fetch)
        const apiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!apiResponse.ok) {
            // Forward API errors (masking key issues for security)
            const errorBody = await apiResponse.json().catch(() => ({}));
            const errorMessage = errorBody?.error?.message || apiResponse.statusText || 'Unknown API Error';
            console.error(`Gemini API Error (${apiResponse.status}): ${errorMessage}`);
             // Don't expose detailed internal errors or key issues to the client
            return response.status(502).json({ error: `Failed to get analysis from upstream service.` }); 
        }

        const result = await apiResponse.json();
        const candidate = result.candidates?.[0];

        if (candidate && candidate.content?.parts?.[0]?.text) {
            const text = candidate.content.parts[0].text;
            let sources = [];
            const groundingMetadata = candidate.groundingMetadata;
            if (groundingMetadata && groundingMetadata.groundingAttributions) {
                sources = groundingMetadata.groundingAttributions
                    .map(attribution => ({
                        uri: attribution.web?.uri,
                        title: attribution.web?.title,
                    }))
                    .filter(source => source.uri && source.title); 
            }
             // 6. Send the successful result back to the frontend
            return response.status(200).json({ text, sources }); 
        } else {
             // Handle safety blocks or empty responses
            const finishReason = candidate?.finishReason;
            console.error("Gemini API Response Issue (Server):", { finishReason, safetyRatings: candidate?.safetyRatings, result });
            let message = 'No content received from API.';
            if (finishReason === 'SAFETY') message = 'Content blocked due to safety settings.';
            else if (finishReason === 'RECITATION') message = 'Content blocked due to potential recitation issues.';
            else if (finishReason) message = `Generation stopped: ${finishReason}`;
            return response.status(500).json({ error: message });
        }

    } catch (error) {
        console.error("Serverless Function Error:", error);
        return response.status(500).json({ error: 'An internal server error occurred.' });
    }
}
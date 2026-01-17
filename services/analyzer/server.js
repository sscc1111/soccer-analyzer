/**
 * Simple HTTP server for Cloud Run deployment
 * Wraps the analyzer handler with basic HTTP server functionality
 */

const { createServer } = require('http');
const { handler } = require('./dist/index');

const PORT = process.env.PORT || 8080;

const server = createServer(async (req, res) => {
  // Health check endpoint for Cloud Run probes
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }));
    return;
  }

  // Only accept POST requests to the root endpoint
  if (req.url === '/' && req.method === 'POST') {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        // Parse request body
        const parsedBody = body ? JSON.parse(body) : {};
        const { matchId, jobId, type } = parsedBody;

        // Respond immediately to avoid timeout
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          message: 'Job started',
          matchId,
          jobId,
        }));

        // Create a minimal request/response wrapper for async processing
        const mockReq = {
          body: parsedBody,
          method: req.method,
          url: req.url,
          headers: req.headers,
        };

        // Dummy response object for async processing (response already sent)
        const mockRes = {
          statusCode: 200,
          headers: {},
          status(code) {
            this.statusCode = code;
            return this;
          },
          json(data) {
            // Response already sent, just log
            console.log('Handler completed:', JSON.stringify(data));
            return this;
          },
        };

        // Run handler asynchronously (don't await)
        handler(mockReq, mockRes).catch((error) => {
          console.error('Async handler error:', error.message || error);
        });
      } catch (error) {
        console.error('Error processing request:', error);
        // Only send error response if headers not sent yet
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: false,
            error: error.message || 'Internal server error',
          }));
        }
      }
    });

    req.on('error', (error) => {
      console.error('Request error:', error);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: false,
        error: 'Bad request',
      }));
    });
  } else {
    // Method not allowed
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: false,
      error: 'Method not allowed. Use POST to / endpoint.',
    }));
  }
});

server.listen(PORT, () => {
  console.log(`Analyzer service listening on port ${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
  console.log('Ready to process match analysis requests');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
});

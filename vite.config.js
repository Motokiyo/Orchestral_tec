import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import extractAiHandler from './api/extract-ai.js'
import requestCodeHandler from './api/request-code.js'
import verifyCodeHandler from './api/verify-code.js'
import sessionHandler from './api/session.js'
import logoutHandler from './api/logout.js'

const localApiHandlers = {
  '/api/extract-ai': extractAiHandler,
  '/api/request-code': requestCodeHandler,
  '/api/verify-code': verifyCodeHandler,
  '/api/session': sessionHandler,
  '/api/logout': logoutHandler,
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  process.env.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || env.GOOGLE_API_KEY

  return {
  plugins: [
    react(),
    {
      name: 'local-api',
      configureServer(server) {
        for (const [route, handler] of Object.entries(localApiHandlers)) {
          server.middlewares.use(route, async (req, res) => {
          let raw = ''
          req.on('data', (chunk) => { raw += chunk })
          req.on('end', async () => {
            try {
              req.body = raw ? JSON.parse(raw) : {}
              const response = {
                status(code) {
                  res.statusCode = code
                  return response
                },
                json(payload) {
                  res.setHeader('Content-Type', 'application/json')
                  res.end(JSON.stringify(payload))
                },
                setHeader(name, value) {
                  res.setHeader(name, value)
                  return response
                },
              }
              await handler(req, response)
            } catch (err) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: err.message }))
            }
          })
        })
        }
      },
    },
  ],
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          pdfjs: ['pdfjs-dist'],
        },
      },
    },
  },
  }
})

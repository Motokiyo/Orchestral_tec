import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import extractAiHandler from './api/extract-ai.js'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  process.env.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || env.GOOGLE_API_KEY

  return {
  plugins: [
    react(),
    {
      name: 'local-api-extract-ai',
      configureServer(server) {
        server.middlewares.use('/api/extract-ai', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Method not allowed' }))
            return
          }

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
              }
              await extractAiHandler(req, response)
            } catch (err) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: err.message }))
            }
          })
        })
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

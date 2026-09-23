import { defineConfig, loadEnv } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import react from '@vitejs/plugin-react'
import extractAiHandler from './api/extract-ai.js'
import requestCodeHandler from './api/request-code.js'
import verifyCodeHandler from './api/verify-code.js'
import sessionHandler from './api/session.js'
import logoutHandler from './api/logout.js'

// After the build, write into dist/sw.js the list of every built file, plus a
// version derived from their content: the service worker then stores the whole
// app at install (offline from the first opening) and each deploy gets a new
// cache, old ones being dropped.
function precacheServiceWorker() {
  let outDir = 'dist'
  return {
    name: 'orkmap-precache-sw',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const swPath = path.join(outDir, 'sw.js')
      if (!fs.existsSync(swPath)) return
      const files = []
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) walk(full)
          else files.push(full)
        }
      }
      walk(outDir)
      const hash = crypto.createHash('sha256')
      const urls = []
      for (const file of files.sort()) {
        const rel = '/' + path.relative(outDir, file).split(path.sep).join('/')
        if (rel === '/sw.js' || rel.endsWith('.map') || rel.startsWith('/.')) continue
        urls.push(rel)
        hash.update(rel).update(fs.readFileSync(file))
      }
      const version = hash.digest('hex').slice(0, 12)
      const sw = fs.readFileSync(swPath, 'utf8')
        .replace('__ORKMAP_BUILD_VERSION__', version)
      fs.writeFileSync(swPath, `self.__ORKMAP_PRECACHE__ = ${JSON.stringify(urls)};\n${sw}`)
    },
  }
}

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
  process.env.ALLOWED_EMAILS = process.env.ALLOWED_EMAILS || env.ALLOWED_EMAILS || ''

  return {
  plugins: [
    react(),
    precacheServiceWorker(),
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

# Admin console (React + Vite)

The staff and administrator interface. It is a single-page app that talks to the Node server in the parent folder.

```bash
npm install
npm run build      # production build into dist/ (the Node server serves it)
npm run dev        # hot-reload dev server on :5173, proxies API calls to :4000
npm run lint
```

- Source is in `src/` (`App.jsx` is the shell; `components/` holds the pages; `styles/admin.css` is the only stylesheet).
- The customer pages (kiosk, display, QR poster) are **not** here: they are plain files in `../public` and need no build.
- `vite.config.js` points Vite at `../public` for shared images, and can use HTTPS in dev: see `.env.example`.

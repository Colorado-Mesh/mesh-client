These small generated JavaScript loaders are statically bundled into the Node translation worker.
No JavaScript is downloaded or evaluated at runtime. WASM and model data are opt-in downloads.

- `bergamot.js`: Mozilla Firefox revision `48d55cf7ec80093903e2ef7f58b61a84a22ef716`,
  `toolkit/components/translations/bergamot-translator/bergamot-translator.js`.
  Original SHA-256: `faff1ef6285b0d26f01787776fd49299dfb756ecb9688aa990c250e66797b47d`.
  MPL-2.0. Changes: a default export and explicit `globalThis` for generated native exports
  (the statically bundled Node worker runs in strict mode).
- `fasttext.js`: Mozilla Firefox revision `62eb30b2013df25fab4cf5d382290ceaf746a89d`,
  `toolkit/components/translations/fasttext/fasttext_wasm.js`.
  Original SHA-256: `34dd65d4ac93ec22e0b639441f9aae467fc5faf9e09d17b3e287f32b53182ead`.
  MIT. Changes: default export and lexical `self` / `importScripts` adapter for Node.
  The adapter supplies no browser/network APIs and throws if script loading is attempted.

Source headers are preserved. The separately downloaded language-identification model is
CC-BY-SA-3.0, not MIT. See `docs/credits.md` for licenses and model attribution.

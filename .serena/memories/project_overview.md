# ST-VarSystemExtension Overview
- Purpose: SillyTavern front-end extension providing a dedicated UI entry for the variable system plugin; will orchestrate snapshot/template management from the client side.
- Stack: Plain JavaScript module loaded by SillyTavern; leverages SillyTavern globals (jQuery, EDITOR, renderExtensionTemplateAsync) and HTML templates under `assets/templates`.
- Structure: `manifest.json` declares the extension; `index.js` injects the top-bar drawer entry; `assets/templates/appHeaderVarSystemDrawer.html` holds the drawer markup. No build tooling yet.
- Deployment: copy folder to `SillyTavern/public/scripts/extensions/third-party/ST-VarSystemExtension` (or symlink) and enable via the Extensions UI.
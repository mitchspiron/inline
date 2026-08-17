/**
 * Styles de l'overlay, injectés depuis le JS pour rester en un seul fichier
 * livré. Toutes les classes sont préfixées `cms-ui-` : aucune collision
 * possible avec la charte du site.
 */
export const OVERLAY_CSS = `
.cms-ui-bar, .cms-ui-banner, .cms-ui-blocker { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }

[data-cms] { outline-offset: 3px; transition: outline-color .12s; outline: 2px dashed transparent; }
.cms-ui-on [data-cms]:hover { outline-color: #b3c8ff; cursor: text; }
.cms-ui-on [data-cms][contenteditable="true"] { outline: 2px solid #0b5cff; }

.cms-ui-bar {
  position: fixed; z-index: 2147483000; left: 50%; bottom: 20px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 14px;
  padding: 10px 14px; border-radius: 12px;
  background: #101828; color: #fff; font-size: 14px;
  box-shadow: 0 8px 28px rgba(16,24,40,.28);
}
.cms-ui-status { opacity: .85; white-space: nowrap; }
.cms-ui-status[data-dirty="true"] { opacity: 1; font-weight: 600; }
.cms-ui-btn {
  border: 0; border-radius: 8px; padding: 8px 14px; font: inherit; font-weight: 600; cursor: pointer;
  background: #0b5cff; color: #fff;
}
.cms-ui-btn:disabled { opacity: .45; cursor: default; }
.cms-ui-btn-ghost { background: transparent; color: #cdd5e0; font-weight: 500; padding: 8px 6px; }
.cms-ui-btn-ghost:hover:not(:disabled) { color: #fff; text-decoration: underline; }

.cms-ui-banner {
  position: fixed; z-index: 2147483000; left: 50%; top: 16px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 14px; max-width: min(92vw, 640px);
  padding: 12px 16px; border-radius: 12px; font-size: 14px; line-height: 1.4;
  background: #fff; color: #101828; border: 1px solid #d0d5dd;
  box-shadow: 0 8px 28px rgba(16,24,40,.18);
}
.cms-ui-banner[data-tone="error"] { border-color: #f2b8b5; background: #fff6f5; }
.cms-ui-banner[data-tone="success"] { border-color: #a6e0bd; background: #f3fbf6; }
.cms-ui-banner-actions { display: flex; gap: 8px; margin-left: auto; }
.cms-ui-banner .cms-ui-btn-ghost { color: #475467; }
.cms-ui-banner .cms-ui-btn-ghost:hover { color: #101828; }

.cms-ui-toolbar {
  position: absolute; z-index: 2147483200;
  display: flex; flex-wrap: wrap; gap: 10px; max-width: min(94vw, 720px);
  padding: 8px 10px; border-radius: 10px;
  background: #fff; border: 1px solid #d0d5dd;
  box-shadow: 0 6px 20px rgba(16,24,40,.18);
  font-size: 12px;
}
.cms-ui-toolbar[hidden] { display: none; }
.cms-ui-tool-group { display: flex; align-items: center; gap: 3px; }
.cms-ui-tool-label {
  margin-right: 4px; color: #667085; font-size: 11px; text-transform: uppercase;
  letter-spacing: .04em; white-space: nowrap;
}
.cms-ui-tool {
  border: 1px solid #e4e7ec; border-radius: 6px; padding: 4px 8px;
  font: inherit; background: #fff; color: #344054; cursor: pointer; white-space: nowrap;
}
.cms-ui-tool:hover { background: #f2f4f7; }
.cms-ui-tool[aria-pressed="true"] { background: #0b5cff; border-color: #0b5cff; color: #fff; }
.cms-ui-swatch {
  width: 20px; height: 20px; padding: 0; border-radius: 50%; border: 1px solid #d0d5dd;
}
.cms-ui-swatch[aria-pressed="true"] { outline: 2px solid #0b5cff; outline-offset: 2px; }

.cms-ui-blocker {
  position: fixed; inset: 0; z-index: 2147483600; display: none;
  align-items: center; justify-content: center; padding: 32px; text-align: center;
  background: #fff; color: #101828; font-size: 17px; line-height: 1.5;
}
@media (max-width: 767px) {
  .cms-ui-blocker { display: flex; }
  .cms-ui-bar, .cms-ui-banner, .cms-ui-toolbar { display: none; }
}
`;

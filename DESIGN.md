# Design the training workspace

## Brand packs

The application and Training Content Studio share a pack under `shared/brand/<pack>/`. `BRAND` selects it; the default is `default`. Names use lowercase letters, digits and hyphens. Missing or incomplete packs fail at build or backend startup.

To add a pack, copy [the default pack](shared/brand/default/) into a new directory. Supply these four files:

| File | Role |
| --- | --- |
| `tokens.css` | Palette, typography and shared component tokens |
| `logo.svg` | Stacked identity for entry pages; default artwork is 414 × 252 |
| `logo-horizontal.svg` | Wide identity for covers, data maintenance and PDFs; default artwork is 450 × 100 |
| `brand.json` | Organization name, title, logo alternative text/size, e-mail footer and Studio theme aliases |

Keep the logo aspect ratio. Set `logo_size` in `brand.json` to the stacked artwork's width and height. For PDFs, use plain SVG paths and text with a viewBox; the renderer also supports the existing embedded PNG/mask format. Unsupported artwork can leave a PDF without its logo. Test the PDF output when adding a pack.

Use the default JSON field names: `organization`, `title`, `logo_alt`, `logo_size`, `email_footer` and `studio_theme_aliases`. The optional `course_id_prefix` controls generated starter-course IDs. Keep artwork rights and any pack-specific guidance in the new pack's README.

Keep every CSS custom property name. Names such as `brand-pink` are stable API names, not a requirement to use that color.

| Tokens | Purpose |
| --- | --- |
| `brand-blue` | Primary structure, links and mail |
| `brand-pink`, `brand-burgundy` | Action accent and its darker variant |
| `brand-cyan` | Decorative highlight |
| `brand-green*`, `brand-brown*` | Success and chart accents |
| `surface`, `canvas`, `surface-muted` | Backgrounds |
| `ink`, `text-secondary`, `text-muted` | Text hierarchy |
| `stroke`, `stroke-subtle`, `focus` | Dividers and keyboard focus |
| `danger`, `warning`, `*-soft` | Semantic states and their pale backgrounds |
| `ms-*` | Microsoft sign-in mark colors, separate from organization colors |

Set `BRAND=<pack>` in the deployment environment. Compose passes it as the `BRAND` build argument to both [Dockerfile](Dockerfile) and [Dockerfile.web](Dockerfile.web), and to backend services at runtime. Rebuild both images after changing packs:

```bash
docker compose build
docker compose up -d --wait
```

Identity access belongs in [frontend/src/brand.ts](frontend/src/brand.ts), [Studio's brand module](vendor/scormly/src/brand.ts) and [training.brand](backend/training/brand.py). General components must not import a specific deployment pack.

## Apply runtime identity

**Settings → Settings** changes organization name and logo without a build. Clearing either restores the pack default. Logos accept PNG, JPEG or WebP, up to 2 MiB and 2048 pixels per side. The server re-encodes them as PNG and stores them in the database.

Runtime logos fit the existing header, cover and PDF spaces while preserving aspect ratio. Runtime names update workspace headings and document title. Runtime identity does not recolor the pack or rewrite already exported course packages.

Interface languages are English, Traditional Chinese and Spanish. Settings selects the available list unless the server sets `INTERFACE_LANGUAGES`. A single language hides the picker. Authored content remains in its original language.

## Keep controls and text consistent

Use local system font stacks. App titles are 27px, section headings 18px, body text 14px and labels at least 12px. Mobile inputs are at least 16px. Use the existing token scale for spacing, radii and shadows.

Reuse `.page-heading`, `.panel`, `.btn`, tables, `Modal`, badges and navigation. Keep one primary action per section. Use real counts and task labels. Show focus, hover, loading, error, empty and disabled states. Body and action text should meet 4.5:1 contrast. Mobile targets are 44px.

Navigation groups Home, My training, Training, Exams, Reports, People and Settings by capability. Tabs wrap on small screens. Put personal next actions on Home and aggregate reporting under Reports.

## Separate editing from publication

Use **Training Content Studio** for the editor. **Save draft** and **Saved locally** describe device storage. **Download backup** is the editable project. **Publish to course** uploads package/source files. **Make available to learners** releases the course afterward.

New Studio courses use the `company` theme preset backed by the selected pack. Existing presets and custom themes remain valid. The editor shell uses the pack while the canvas previews the authored course theme.

Keep course publication, session registration, attendance and exam publication distinct. Show capacity and exceptional registration states clearly. A pending request reserves a seat. Show the server's next permitted attempt time rather than implying that a disabled Retake button is an error.

## Use reusable cover artwork

Cover art is independent of course titles and logo overlays. Preserve saved asset IDs. The picker includes illustrated scenes and 100 legacy geometric patterns. New courses and unknown cover IDs use Training classroom.

On the 1200 × 600 scene canvas, keep the subject readable after card/strip cropping and title/logo overlays. The main subject should survive within x 680-1050 and y 150-370. Avoid putting essential content under the title below y 370.

[generate-scene-covers.mjs](frontend/generate-scene-covers.mjs) and [generate-covers.mjs](frontend/generate-covers.mjs) maintain the combined catalog. Do not bake organization names or course titles into reusable art.

## Check a design change

Build both applications and run the relevant frontend/Studio tests. Inspect entry pages, Settings, courses, sessions, exams and Studio at desktop, tablet and phone widths. Check focus, overflow, contrast, logo loading and a mounted path such as `/training/`.

Check all enabled languages. Preview exported course content and sign-in PDFs when changing a pack. See [development checks](docs/DEPLOYMENT.md#develop-locally).

# Training System demo

The real frontend with synthetic people and an in-browser API. No backend or credentials are needed.
Uses the default brand only. State persists for this tab; Reset starts over. The language choice stays, as in the product.
Administrator is the initial view; use the bar to switch to Taylor Lin's learner view. Switching opens that person's home page.
Sign out to see the sign-in page. Any username and password work; known demo users select that person.
On the public registration page, use the bar to sign in as Administrator or Learner.

```sh
cd frontend
export PATH="$HOME/.local/bin:$PATH"
npm run build:demo
```

`DEMO_BASE` defaults to `/Training-System/demo/`; set it to another absolute path ending in `/` if needed.
Copy **the contents** of `frontend/dist-demo/` into `demo/` on the `gh-pages` branch, then publish that branch.
Keep the existing project page. In the site's root `404.html`, add this external script:

```html
<script src="/Training-System/demo/redirect.js"></script>
```

The script restores nested routes, queries and fragments; it ignores paths outside the demo.
Workshop registration: `/Training-System/demo/register#demo-forklift-link`.
Downloads, Studio and other writes show a short refusal. SCORM is a local lesson preview; essays await review.

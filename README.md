# ldes.tech

Source of the [ldes.tech](https://ldes.tech) website: a Jekyll site built and deployed to GitHub Pages via
GitHub Actions (see `.github/workflows/jekyll-build.yml`).

## Local development

```sh
bundle install
bundle exec jekyll serve
```

## Structure

- `_data/feeds.yml` — a selection of LDES examples (`/examples/`)
- `_data/publications.yml` — the publications list (`/publications/`)
- `_posts/` — news and blog posts (`/news/`), also exposed as an RSS feed at `/news/feed.xml`
- `community/`, `tools/` — static pages

The site embeds RDFa (schema.org, DCAT) and JSON-LD structured data throughout.

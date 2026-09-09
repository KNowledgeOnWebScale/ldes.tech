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

## Contextual paper citations

Research papers remain at `/publications/` and are discovered from relevant content rather than the main menu.
To add a paper box to an HTML page or Markdown post, reference its stable `id` in `_data/publications.yml`:

```liquid
{% include paper-citation.html paper="base-registries" context="Why this paper is relevant here." %}
```

The box uses the publication's first link to read the paper and its authors, publication year, venue, pages,
and DOI (when available) to display a citation. Keep a paper or preprint as the first link for cited papers.
For a feed example, set `paper` to the publication id and add a `paper_context` explanation in `_data/feeds.yml`.

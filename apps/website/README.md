# Wordless website

Static Vite + React marketing site for Wordless. It is intentionally independent of the Electron renderer and is deployed as static files through Nginx.

## Commands

```bash
npm run dev --workspace @wordless/website
npm run build --workspace @wordless/website
```

`dev` is only for local use. The production deployment serves `dist/` with Nginx.

## Product media

The generated `wordless-workspace.png` is the default visual. To show a recorded product walkthrough, place a compressed WebM in `public/media/` and set:

```bash
VITE_WORKSPACE_VIDEO=/media/workspace-tour.webm
```

at build time. No video is loaded until that variable is set.

## Nginx deployment

1. Copy `deploy/wordless.nginx.conf` into `/etc/nginx/sites-available/wordless` and set the real domain and deploy path.
2. Create the initial deploy path and grant the deployment user access:

```bash
sudo mkdir -p /var/www/wordless/releases
sudo chown -R deploy:deploy /var/www/wordless
sudo ln -sfn /var/www/wordless/releases/initial /var/www/wordless/current
```

3. Enable the virtual host, run `sudo nginx -t`, then reload Nginx.
4. Add a Let's Encrypt certificate with `sudo certbot --nginx -d <domain>`.
5. Add the GitHub Actions secrets described in `.github/workflows/deploy-website.yml`.

The deployment account needs write access to the deployment directory and passwordless permission for only the Nginx validation and reload commands. Add a narrow sudoers rule after checking the command paths with `command -v nginx` and `command -v systemctl`:

```text
deploy ALL=(root) NOPASSWD: /usr/sbin/nginx -t, /usr/bin/systemctl reload nginx
```

The workflow uploads a new directory, checks it, atomically switches the `current` symlink, and retains the latest three deployment directories. A failed upload leaves the serving release untouched.

"""Draws 4me's two diagrams by hand, as SVG (and PNG beside them): the system as it runs, and the road from a push
to production.

    python3 architecture/build.py

Needs only Python and, for the PNGs, `rsvg-convert` (brew install librsvg). Every service is a tile in its own colour
with its real mark on it: brand marks from Simple Icons (CC0), the rest from Lucide (ISC); see icons/CREDITS.txt.
Every box and every line is placed here by hand, on a grid, so nothing crosses.
"""

import re
import shutil
import subprocess
from html import escape
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "icons" / "src"

# name: (source svg, tile colour, mark colour)
TILES = {
    "nextjs": ("nextdotjs", "#111111", "#ffffff"),
    "vercel": ("vercel", "#111111", "#ffffff"),
    "workers": ("cloudflareworkers", "#F38020", "#ffffff"),
    "hono": ("hono", "#E36002", "#ffffff"),
    "neon": ("neon", "#0B1F1A", "#00E599"),
    "s3": ("amazons3", "#3F8624", "#ffffff"),
    "resend": ("resend", "#111111", "#ffffff"),
    "google": ("google", "#4285F4", "#ffffff"),
    "webrtc": ("webrtc", "#333333", "#ffffff"),
    "actions": ("githubactions", "#2088FF", "#ffffff"),
    "github": ("github", "#181717", "#ffffff"),
    "gpg": ("gnuprivacyguard", "#0093DD", "#ffffff"),
    "users": ("lucide-users", "#5B4BC4", "#ffffff"),
    "laptop": ("lucide-laptop", "#5B4BC4", "#ffffff"),
    "browser": ("lucide-app-window", "#2B3A55", "#ffffff"),
    "hub": ("lucide-radio-tower", "#C2410C", "#ffffff"),
    "table": ("lucide-moon-star", "#C2410C", "#ffffff"),
    "lobby": ("lucide-list-ordered", "#C2410C", "#ffffff"),
    "turn": ("lucide-audio-lines", "#F38020", "#ffffff"),
    "cron": ("lucide-clock-8", "#C2410C", "#ffffff"),
    "secrets": ("lucide-key-round", "#B91C1C", "#ffffff"),
    "music": ("lucide-music", "#111111", "#ffffff"),
}

FONT = "Helvetica Neue, Helvetica, Arial, sans-serif"
GREY, GREEN, RED, PURPLE = "#7a808c", "#1f9d55", "#c0392b", "#7c6fd6"
T = 84  # tile size
H = T // 2


def mark(name: str) -> str:
    """The service's tile: a rounded square in its colour with its mark in the middle, drawn on a 256 grid."""
    src, bg, fg = TILES[name]
    svg = (SRC / f"{src}.svg").read_text()
    inner = re.search(r"<svg[^>]*>(.*)</svg>", svg, re.S).group(1)
    inner = re.sub(r"<title>.*?</title>|<!--.*?-->", "", inner, flags=re.S)
    if src.startswith("lucide-"):  # line icons
        glyph = f'<g fill="none" stroke="{fg}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">{inner}</g>'
    else:  # filled brand marks
        glyph = f'<g fill="{fg}">{inner}</g>'
    return (
        f'<rect x="4" y="4" width="248" height="248" rx="44" fill="{bg}"/>'
        f'<g transform="translate(60 60) scale(5.6667)">{glyph}</g>'
    )


class Page:
    def __init__(self, w: int, h: int, title: str):
        self.w, self.h, self.title = w, h, title
        self.back: list[str] = []  # clusters
        self.lines: list[str] = []
        self.front: list[str] = []  # tiles and words

    def cluster(self, x, y, w, h, title, fill="#E9F2FB", stroke="#A7C1DA", dashed=False, icon=None, bottom=False):
        dash = ' stroke-dasharray="6 4"' if dashed else ""
        self.back.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{fill}" stroke="{stroke}" stroke-width="1.2"{dash}/>'
        )
        tx, ty = x + 12, (y + h - 14 if bottom else y + 22)  # (a title at the bottom leaves the top free for a line in)
        if icon:
            self.back.append(f'<svg x="{x + 10}" y="{ty - 14}" width="18" height="18" viewBox="0 0 256 256">{mark(icon)}</svg>')
            tx = x + 34
        self.back.append(f'<text x="{tx}" y="{ty}" font-size="13" fill="#3b4250">{escape(title)}</text>')

    def tile(self, cx, cy, icon, *lines, size=T):
        h = size // 2
        self.front.append(f'<svg x="{cx - h}" y="{cy - h}" width="{size}" height="{size}" viewBox="0 0 256 256">{mark(icon)}</svg>')
        y = cy + h + 18
        for i, line in enumerate(lines):
            size_, color = (13.5, "#1f2430") if i == 0 else (11.5, "#5b6270")
            self.front.append(
                f'<text x="{cx}" y="{y}" text-anchor="middle" font-size="{size_}" fill="{color}">{escape(line)}</text>'
            )
            y += 15

    def line(self, pts, color=GREY, dashed=False, arrow=True, label=None, at=None, anchor="middle"):
        d = "M" + " L".join(f"{x} {y}" for x, y in pts)
        dash = ' stroke-dasharray="6 5"' if dashed else ""
        head = f' marker-end="url(#a{color[1:]})"' if arrow else ""
        self.lines.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.6"{dash}{head}/>')
        if label:
            x, y = at
            self.front.append(
                f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="11.5" fill="#4b5260" '
                f'paint-order="stroke" stroke="#ffffff" stroke-width="4" stroke-linejoin="round">{escape(label)}</text>'
            )

    def note(self, x, y, text, size=11.5, color="#5b6270", anchor="start"):
        self.front.append(
            f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}" fill="{color}" '
            f'paint-order="stroke" stroke="#ffffff" stroke-width="4" stroke-linejoin="round">{escape(text)}</text>'
        )

    def save(self, name: str):
        markers = "".join(
            f'<marker id="a{c[1:]}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
            f'<path d="M0 0 L10 5 L0 10 z" fill="{c}"/></marker>'
            for c in (GREY, GREEN, RED, PURPLE)
        )
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}" '
            f'font-family="{FONT}"><defs>{markers}</defs>'
            f'<rect width="{self.w}" height="{self.h}" fill="#ffffff"/>'
            + "".join(self.back + self.lines + self.front)
            + f'<text x="{self.w / 2}" y="{self.h - 26}" text-anchor="middle" font-size="17" fill="#2b303b">{escape(self.title)}</text>'
            "</svg>"
        )
        out = HERE / f"{name}.svg"
        out.write_text(svg)
        if shutil.which("rsvg-convert"):
            subprocess.run(["rsvg-convert", "-z", "2", "-o", str(HERE / f"{name}.png"), str(out)], check=True)


def system():
    # columns and rows (tile centres)
    A, B, C, D, E, F, G = 130, 390, 640, 900, 1150, 1400, 1660
    R0, R1, R2 = 150, 430, 710
    p = Page(1790, 960, "4me · System Architecture")

    p.cluster(40, 60, 180, 480, "Players' browsers", "#F1EEFB", "#BDB2EA")
    p.cluster(300, 330, 180, 480, "Vercel · sin1", icon="vercel")
    p.cluster(800, 60, 700, 750, "Cloudflare Workers · api.2die429.com", "#FDF1E6", "#EDBB8E", icon="workers")
    p.cluster(1570, 330, 180, 480, "Data", "#E9F2FB", "#A7C1DA")

    p.tile(A, R0, "users", "Other players", "their browsers")
    p.tile(A, R1, "browser", "Reader's browser", "Night Desktop", "Werewolf window")
    p.tile(B, R1, "nextjs", "Next.js 16 · 2die429.com", "server actions", "HMAC sessions · tickets")
    p.tile(B, R2, "music", "Sounds & music", "static CC0 files")
    p.tile(C, R0, "google", "Google OAuth", "code flow + PKCE")
    p.tile(C, R2, "resend", "Resend", "transactional email")
    p.tile(D, R0, "cron", "Cron trigger", "every 10 minutes")
    p.tile(D, R1, "hono", "API Worker", "Hono · public + /internal")
    p.tile(E, R0, "turn", "Cloudflare TURN", "ICE for voice")
    p.tile(F, R0, "hub", "Hub DO", "live updates")
    p.tile(E, R2, "table", "GameTable DO", "one per table · clock")
    p.tile(F, R2, "lobby", "TableLobby DO", "open tables")
    p.tile(G, R1, "neon", "Neon Postgres", "Drizzle · neon-http")
    p.tile(G, R2, "s3", "Photo bucket", "S3-compatible")

    # the players: voice goes browser to browser
    mid = (R0 + R1) // 2
    p.line([(A, R1 - H - 6), (A, R0 + H + 38)], PURPLE, dashed=True, arrow=False)
    p.front.append(f'<svg x="{A - 15}" y="{mid + 5}" width="30" height="30" viewBox="0 0 256 256">{mark("webrtc")}</svg>')
    p.note(A + 22, mid + 18, "voice")
    p.note(A + 22, mid + 32, "WebRTC P2P")

    # the reader and the web
    p.line([(A + H, R1), (B - H - 4, R1)], GREEN, label="HTTPS", at=((A + B) / 2 + 4, R1 - 8))
    p.line([(B, R1 + H + 58), (B, R2 - H - 4)], GREY, dashed=True, label="static files", at=(B + 8, (R1 + R2) / 2 + 30), anchor="start")
    p.line([(B + 30, R1 - H), (B + 30, R0), (C - H - 4, R0)], RED, label="sign in", at=((B + C) / 2 + 6, R0 - 8))
    p.line([(B + H, R1 + 26), (C - 74, R1 + 26), (C - 74, R2), (C - H - 4, R2)], GREY, dashed=True, label="email", at=(C - 80, (R1 + R2) / 2 + 40), anchor="end")
    p.line([(B + H, R1), (D - H - 4, R1)], RED, label="/internal · Bearer token", at=((B + D) / 2 + 20, R1 - 8))
    # the reader straight to the API: below everything, into the API's left side
    p.line(
        [(A, R1 + H + 62), (A, 870), (D - 120, 870), (D - 120, R1 + 30), (D - H - 4, R1 + 30)],
        GREEN, label="public API · WSS with a ticket", at=((A + D) / 2 - 60, 862),
    )

    # inside Cloudflare
    p.line([(D, R0 + H + 40), (D, R1 - H - 4)], GREY, label="calls the API", at=(D + 8, (R0 + R1) / 2 + 30), anchor="start")
    p.line([(D + H, R1 - 30), (E - 80, R1 - 30), (E - 80, R0), (E - H - 4, R0)], GREY, dashed=True, label="ICE credentials", at=(E - 86, R0 + 70), anchor="end")
    p.line([(D + H, R1 - 15), (F - 90, R1 - 15), (F - 90, R0), (F - H - 4, R0)], GREY, label="/live", at=(F - 84, R0 + 70), anchor="start")
    p.line([(D + H, R1), (G - H - 4, R1)], GREY, label="SQL over HTTPS", at=((E + F) / 2 + 20, R1 - 8))
    p.line([(D + H, R1 + 15), (1535, R1 + 15), (1535, R2), (G - H - 4, R2)], GREY, dashed=True, label="PUT photos", at=(1543, R2 - 80), anchor="start")
    p.line([(D + H, R1 + 30), (E, R1 + 30), (E, R2 - H - 4)], GREY, label="WSS /tables/:code", at=(E + 8, R2 - 80), anchor="start")
    p.line([(E + H, R2), (F - H - 4, R2)], GREY, label="listing", at=((E + F) / 2, R2 - 8))

    p.save("system")


def deploy():
    A, B, C, D, E = 130, 420, 720, 1080, 1370
    R0, R1, R2, R3 = 150, 400, 650, 900
    p = Page(1500, 1170, "4me · Deployment")

    p.cluster(600, 285, 240, 790, "production", "#FDEEEE", "#E3A2A2", dashed=True, icon="secrets")
    p.note(720, 1012, "GitHub environment secrets:", anchor="middle", color="#9b2c2c")
    p.note(720, 1028, "DATABASE_URL · ADMIN_TOKEN · IP_SALT", anchor="middle", color="#9b2c2c")
    p.note(720, 1044, "Cloudflare + Vercel tokens", anchor="middle", color="#9b2c2c")
    p.cluster(330, 285, 180, 200, "Neon", "#E7F7F1", "#93D4BD", icon="neon")
    p.cluster(960, 560, 240, 200, "Cloudflare", "#FDF1E6", "#EDBB8E", icon="workers")
    p.cluster(960, 810, 240, 200, "Vercel · sin1", "#EEF0F3", "#B9BFC9", icon="vercel")
    p.cluster(40, 810, 180, 230, "AWS · ap-southeast-1", "#EEF6E8", "#A9CC94", bottom=True)

    p.tile(A, R0, "laptop", "Developer", "git push · pull request")
    p.tile(B, R0, "github", "GitHub", "4l0ne4ever/4me · main")
    p.tile(C, R0, "actions", "CI", "lint · migrations · types", "tests · build")
    p.tile(C, R1, "actions", "Migrate database", "drizzle-kit migrate")
    p.tile(C, R2, "actions", "Deploy API", "wrangler · smoke /health")
    p.tile(C, R3, "actions", "Deploy web", "vercel build · --prebuilt")
    p.tile(B, R1, "neon", "Neon Postgres", "production")
    p.tile(A, R1, "actions", "Nightly backup", "03:00 ICT · pg_dump", "checked for entries")
    p.tile(A, R2, "gpg", "GPG AES-256", "on the runner")
    p.tile(A, R3, "s3", "Backup bucket", "put-only key · 30 nights")
    p.tile(D, R2, "workers", "4me-api Worker + DOs", "api.2die429.com")
    p.tile(D, R3, "nextjs", "Next.js site", "2die429.com")
    p.tile(E, (R2 + R3) // 2, "users", "Readers", "browsers")

    p.line([(A + H, R0), (B - H - 4, R0)], GREEN, label="git push", at=((A + B) / 2, R0 - 8))
    p.line([(B + H, R0), (C - H - 4, R0)], GREEN, label="push to main / PR", at=((B + C) / 2, R0 - 8))
    p.line([(C, R0 + H + 54), (C, R1 - H - 4)], GREY, label="passes", at=(C + 8, R1 - 70), anchor="start")
    p.line([(C, R1 + H + 40), (C, R2 - H - 4)], GREY, label="then", at=(C + 8, R2 - 70), anchor="start")
    p.line([(C, R2 + H + 40), (C, R3 - H - 4)], GREY, label="then", at=(C + 8, R3 - 70), anchor="start")
    p.line([(C - H, R1), (B + H + 4, R1)], RED, label="apply migrations", at=((B + C) / 2 + 6, R1 - 8))
    p.line([(C + H, R2), (D - H - 4, R2)], RED, label="wrangler deploy", at=((C + D) / 2 - 10, R2 - 22))
    p.note((C + D) / 2 - 10, R2 - 8, "+ Worker secrets", anchor="middle")
    p.line([(C + H, R3), (D - H - 4, R3)], RED, label="vercel deploy --prod", at=((C + D) / 2 - 10, R3 - 8))
    # the nightly backup
    p.line([(B, R0 + H + 40), (B, 255), (A, 255), (A, R1 - H - 4)], GREY, dashed=True, label="schedule 0 20 * * *", at=((A + B) / 2 + 10, 247))
    p.line([(A + H, R1), (B - H - 4, R1)], GREY, dashed=True, label="pg_dump", at=((A + B) / 2 - 6, R1 - 8))
    p.line([(A, R1 + H + 54), (A, R2 - H - 4)], GREY, label="dump", at=(A + 8, R2 - 70), anchor="start")
    p.line([(A, R2 + H + 40), (A, R3 - H - 4)], RED, label="put .dump.gpg", at=(A + 8, R3 - 120), anchor="start")
    # the readers
    rr = (R2 + R3) // 2
    p.line([(E, rr - H), (E, R2), (D + H + 4, R2)], GREEN, label="HTTPS · WSS", at=((D + E) / 2 + 40, R2 - 8))
    p.line([(E, rr + H + 40), (E, R3), (D + H + 4, R3)], GREEN, label="HTTPS", at=((D + E) / 2 + 40, R3 - 8))

    p.save("deploy")


if __name__ == "__main__":
    system()
    deploy()

"""Remove the opaque water baked into port_atlas.png, keep the dock/crane/containers.
Usage: clean_port_water.py in.png out.png   (cells are 150x126, 8 columns)"""
import sys
from PIL import Image
from collections import deque
src, dst = sys.argv[1:3]
im = Image.open(src).convert('RGBA'); W, H = im.size; CW, CH = 150, 126
px = im.load()
SEA = {(52,85,128),(56,88,126),(38,80,113),(34,57,88),(18,41,69)}   # exact painted-water colours of the source sheet
RIPPLE = {(62,133,163),(72,103,112)}                                   # dashes on the water; also used by a few containers
def waterish(p):
    return p[3] > 0 and p[:3] in SEA
def dark(p): return p[3] and p[0] < 60 and p[1] < 50 and p[2] < 60 and not waterish(p)
removed_total = 0
for col in range(W // CW):
    x0 = col * CW
    inside = lambda x, y: 0 <= x < CW and 0 <= y < CH
    seen = set(); q = deque()
    # seed: every waterish pixel on the silhouette boundary (touching transparent or the cell edge)
    for y in range(CH):
        for x in range(CW):
            p = px[x0 + x, y]
            if not waterish(p): continue
            for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                nx, ny = x + dx, y + dy
                if not inside(nx, ny) or px[x0 + nx, ny][3] == 0:
                    q.append((x, y)); seen.add((x, y)); break
    while q:
        x, y = q.popleft()
        for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
            nx, ny = x + dx, y + dy
            if inside(nx, ny) and (nx, ny) not in seen and waterish(px[x0 + nx, ny]):
                seen.add((nx, ny)); q.append((nx, ny))
    for x, y in seen: px[x0 + x, y] = (0, 0, 0, 0)
    for y in range(CH):   # leftover painted-water pixels not reached by the fill (old outline remnants)
        for x in range(CW):
            if waterish(px[x0 + x, y]):
                clear = sum(1 for dx in (-1,0,1) for dy in (-1,0,1) if (dx or dy) and (not inside(x+dx,y+dy) or px[x0+x+dx,y+dy][3] == 0))
                if clear >= 3: px[x0 + x, y] = (0, 0, 0, 0)
    # strip the old square's dark outline: dark pixels that touch no dock (non-dark, non-water) pixel
    for _ in range(4):
        kill = []
        for y in range(CH):
            for x in range(CW):
                if not dark(px[x0 + x, y]): continue
                cnt = 0
                for dx in (-1,0,1):
                    for dy in (-1,0,1):
                        nx, ny = x + dx, y + dy
                        if (dx or dy) and inside(nx, ny):
                            n = px[x0 + nx, ny]
                            if n[3] and not dark(n): cnt += 1
                if cnt < 3: kill.append((x, y))
        for x, y in kill: px[x0 + x, y] = (0, 0, 0, 0)
    # ripple dashes: only where mostly surrounded by already-cleared pixels (a container tile sits among dock pixels)
    for _ in range(2):
        for y in range(CH):
            for x in range(CW):
                p = px[x0 + x, y]
                if p[3] and p[:3] in RIPPLE:
                    clear = sum(1 for dx in (-1,0,1) for dy in (-1,0,1) if (dx or dy) and (not inside(x+dx,y+dy) or px[x0+x+dx,y+dy][3] == 0))
                    if clear >= 5: px[x0 + x, y] = (0, 0, 0, 0)
    removed_total += len(seen)
im.save(dst); print('removed water px', removed_total)

#!/usr/bin/env python3
"""Build the single Noto Serif SC brand font from full source.
Requires fonttools[woff] and brotli. Covers console copy plus GB2312 Chinese;
new console text must be checked again. Does not fetch or modify source files.
"""
import argparse, hashlib, json
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.varLib.instancer import instantiateVariableFont

ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,required=True);args=ap.parse_args()
root=Path(__file__).resolve().parents[2];source=root/'apps/console/src';dest=root/'deploy/maishu/branding/fonts';dest.mkdir(exist_ok=True)
chars=set(range(32,256));copy_chars=set()
for a in range(0xA1,0xF8):
 for b in range(0xA1,0xFF):
  try:chars.update(map(ord,bytes([a,b]).decode('gb2312')))
  except UnicodeDecodeError:pass
for p in source.rglob('*'):
 if p.suffix not in {'.ts','.tsx','.json'} or '.test.' in p.name or '.spec.' in p.name:continue
 for ch in p.read_text():
  if 0x3400<=ord(ch)<=0x9fff or 0xf900<=ord(ch)<=0xfaff:copy_chars.add(ord(ch))
  if ord(ch)>=0x2000 and ord(ch)<=0xffff:chars.add(ord(ch))
font=TTFont(args.source,recalcTimestamp=False);cmap=font.getBestCmap();missing=sorted(copy_chars-set(cmap))
if missing:raise SystemExit('Noto Serif SC source misses console Han characters: '+''.join(map(chr,missing)))
chars.update(copy_chars)
options=subset.Options();options.layout_features=['*'];options.name_IDs=['*'];options.name_languages=['*'];options.recalc_timestamp=False
sub=subset.Subsetter(options=options);sub.populate(unicodes=sorted(chars&set(cmap)));sub.subset(font);font=instantiateVariableFont(font,{'wght':(400,400,600)},inplace=True,optimize=True);font.flavor='woff2';out=dest/'noto-serif-sc.woff2';font.save(out)
report={'family':'Noto Serif SC','weights':[400,600],'sourceSha256':hashlib.sha256(args.source.read_bytes()).hexdigest(),'woff2Sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'bytes':out.stat().st_size,'characters':len(font.getBestCmap()),'consoleHanCharacters':len(copy_chars),'missingConsoleHan':[],'dynamicTextPolicy':'GB2312 and console copy included; rare user-supplied glyphs and emoji may use OS fallback. Code identifiers use the OS monospace stack.'}
(dest/'coverage.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False))

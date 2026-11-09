// Excel (sul modulo originale) e ZIP delle foto: usato sia dall'app degli impiegati sia dalla pagina amministratore.
window.NS = (() => {
  const toDate = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const fmt = (cell, numFmt) => { cell.style = { ...cell.style, numFmt }; }; // gli stili del modulo sono condivisi: va copiato l'oggetto
  const sorted = t => [...t.expenses].sort((a, b) => a.date.localeCompare(b.date));
  const safe = s => String(s).replace(/[^\w\-À-ÿ]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'x';
  const baseName = t => `${safe(t.owner.name)}_${t.date_from}_${safe(t.destination)}`;

  async function buildExcel(t) {
    const tpl = await (await fetch('template/Modulo_Nota_Spese.xlsx')).arrayBuffer();
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(tpl);
    const ws = wb.getWorksheet('Nota Spese');
    ws.getCell('B5').value = t.owner.name; ws.getCell('B6').value = t.owner.department;
    ws.getCell('B7').value = t.client; ws.getCell('B8').value = t.destination;
    for (const [c, iso] of [['B9', t.date_from], ['B10', t.date_to]]) { ws.getCell(c).value = toDate(iso); fmt(ws.getCell(c), 'dd/mm/yyyy'); }
    sorted(t).forEach((e, i) => {
      const r = 14 + i;
      ws.getCell(`A${r}`).value = toDate(e.date); fmt(ws.getCell(`A${r}`), 'dd/mm/yyyy');
      ws.getCell(`B${r}`).value = e.category; ws.getCell(`C${r}`).value = e.description; ws.getCell(`D${r}`).value = e.payment;
      ws.getCell(`E${r}`).value = e.amount; fmt(ws.getCell(`E${r}`), '#,##0.00');
      if (e.notes) ws.getCell(`F${r}`).value = e.notes;
      // Giustificativo: con foto = SI; senza foto = «Fattura» oppure «Pagamento senza scontrino»
      ws.getCell(`G${r}`).value = e.has_photo === false ? (e.reason || 'NO') : 'SI';
    });
    if (t.km_rate != null) ws.getCell('B32').value = t.km_rate;
    if (t.km != null) ws.getCell('B33').value = t.km;
    wb.calcProperties.fullCalcOnLoad = true;
    return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  // getPhoto(expense) → Blob (la foto viene scaricata dal server)
  async function buildZip(t, getPhoto) {
    const zip = new JSZip(); let n = 0;
    for (const e of sorted(t)) {
      const b = await getPhoto(e); if (!b) continue;
      zip.file(`${String(++n).padStart(2, '0')}_${e.date}_${safe(e.category)}_${e.amount.toFixed(2)}.jpg`, b);
    }
    return zip.generateAsync({ type: 'blob' });
  }
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  // Su iPhone/iPad i download diretti dalle app in home sono inaffidabili: si usa il foglio "Condividi" (Salva su File, Mail…)
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
  async function deliver(blob, name) {
    if (isIOS && navigator.canShare) {
      const file = new File([blob], name, { type: blob.type });
      if (navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    }
    download(blob, name);
  }
  return { buildExcel, buildZip, deliver, baseName, sorted };
})();

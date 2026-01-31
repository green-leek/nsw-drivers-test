// ==UserScript==
// @name         NSW Driving Test Availability Scraper (JSON)
// @namespace    https://github.com/users/green-leek
// @version      0.91
// @description  Automatically collects available driving test timeslots from myrta.com after login. Saves results in bookings.json format (compatible with NSW Drivers Test - Find Available Test Times).
// @author       green-leek, Scraper logic from teehee567
// @match        https://www.myrta.com/wps/portal/extvp/myrta/licence/tbs/*
// @match        https://www.myrta.com/*book-test*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-end
// @license      MIT
// @homepageURL  https://github.com/green-leek/nsw-drivers-test
// @supportURL   https://github.com/green-leek/nsw-drivers-test/issues
// @updateURL    https://raw.githubusercontent.com/nsw-drivers-test/userscript/myrta-scraper.user.js
// ==/UserScript==

(function() {
    'use strict';

    const DEBUG = false;

    // ─── UI ──────────────────────────────────────────
    const btn = document.createElement('button');
    btn.textContent = 'Start Scraper';
    btn.style.cssText = `position:fixed;top:16px;right:16px;z-index:100001;padding:12px 20px;font-size:17px;font-weight:bold;background:#c41e3a;color:white;border:none;border-radius:8px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.4);`;
    if (!GM_getValue('S.active') && isLocationPage()) { document.body.appendChild(btn)};

    const status = document.createElement('div');
    status.style.cssText = `position:fixed;top:80px;right:16px;z-index:100000;padding:14px;background:rgba(0,0,0,0.85);color:#eee;border-radius:8px;font-family:Arial,sans-serif;font-size:15px;max-width:380px;line-height:1.4;display:none;`;
    document.body.appendChild(status);

    function setStatus(msg, err = false) {
        status.textContent = msg;
        status.style.background = err ? 'rgba(200,0,0,0.85)' : 'rgba(0,0,0,0.85)';
        status.style.display = 'block';
        if (DEBUG) console.log(`[STATUS${err?' ERROR':''}] ${msg}`);
    }

    // Storage keys
    const S = {
        active: 'scraper_active',
        locs:   'scraper_locs',
        idx:    'scraper_idx',
        data:   'scraper_data'
    };

    function getValidLocations() {
        const selectors = ['#rms_batLocationSelect2', '#locationCode', 'select'];
        let select = null;
        for (const sel of selectors) {
            select = document.querySelector(sel);
            if (select) break;
        }
        if (!select) return [];

        const options = Array.from(select.options);
        const valid = [];

        options.forEach(opt => {
            const val = (opt.value || '').trim();
            const txt = (opt.textContent || '').trim().toLowerCase();
            if (!val || val === '0' || txt.includes('choose') || txt.includes('select') || txt.includes('please') || opt.disabled) return;
            valid.push({
                name: opt.textContent.trim().replace(/\s+/g, ' '),
                code: val
            });
        });

        if (DEBUG) console.log(`Found ${valid.length} valid locations`);
        return valid;
    }

    function isLocationPage() {
        return !!document.querySelector('#rms_batLocLocSel, #rms_batLocationSelect2, #locationCode') ||
               document.body.innerHTML.includes('Choose a location');
    }

    function isSlotsPage() {
        return !!document.querySelector('table#rms_timeSelTable, .rms_timeSelTitle') ||
               !!window.timeslots ||
               !!document.querySelector('#getEarliestTime');
    }

    function clickDijitOrNative(id) {
        if (window.dijit?.byId) {
            const w = dijit.byId(id);
            if (w) { w._onButtonClick?.({}) || w.onClick?.(); return true; }
        }
        const el = document.getElementById(id);
        if (el) { el.click(); return true; }
        return false;
    }

    function navigateBack() {
        clickDijitOrNative('anotherLocationLink') ||
        clickDijitOrNative('backButton') ||
        document.querySelector('#anotherLocationLink, .rms_backButton, [onclick*="back"]')?.click();
    }

    // ─── Main logic ──────────────────────────────────
    btn.onclick = () => {
        const locs = getValidLocations();
        if (!locs.length) {
            setStatus("No valid centres found.\nMake sure you're on the location selection page.", true);
            return;
        }

        const limited = DEBUG ? locs.slice(0, 3) : locs;
        if (!confirm(`Ready to scrape ${limited.length} centres? It may take (${Math.round(locs.length * 2.5)}–${Math.round(locs.length * 5)} minutes or more) to scrape!\n\JSON will be available for download after all data has scraped.`)) return;

        GM_setValue(S.active, true);
        GM_setValue(S.locs, limited);
        GM_setValue(S.idx, 0);
        GM_setValue(S.data, {});

        setStatus(`Starting • 0 / ${limited.length}`);
        setTimeout(processNext, 1200);
    };

    function processNext() {
        if (!GM_getValue(S.active, false) || (!(isLocationPage() || isSlotsPage()))) return;

        let idx = GM_getValue(S.idx, 0);
        const locs = GM_getValue(S.locs, []);
        let data  = GM_getValue(S.data, {});

        if (idx >= locs.length) {
            finish(data);
            return;
        }

        const loc = locs[idx];
        setStatus(`Processing ${idx+1}/${locs.length}: ${loc.name} (${loc.code})`);

        if (isLocationPage()) {
            const sel = document.querySelector('#rms_batLocationSelect2') ||
                        document.querySelector('#locationCode') ||
                        document.querySelector('select');
            if (sel) {
                sel.value = loc.code;
                sel.dispatchEvent(new Event('change', {bubbles:true}));
                setTimeout(() => {
                    clickDijitOrNative('nextButton') ||
                    document.querySelector('#nextButton, button[type="submit"]')?.click();
                    setTimeout(processNext, 1800 + Math.random()*800);
                }, 900);
            } else {
                setStatus("Location selector not found", true);
                setTimeout(nextCentre, 3000);
            }
        }
        else if (isSlotsPage()) {
            collectSlots(loc, data);
        }
        else {
            navigateBack();
            setTimeout(processNext, 2500);
        }
    }

    function collectSlots(loc, results) {
        let slots = [];
        let nextAvailable = null;

        // ─── Preferred: window.timeslots ─────────────
        if (window.timeslots?.ajaxresult?.slots?.listTimeSlot?.length) {
            const raw = window.timeslots.ajaxresult.slots.listTimeSlot;
            nextAvailable = window.timeslots.ajaxresult.slots.nextAvailableDate || null;

            slots = raw
                .filter(s => s.availability === true || s.availability === "true")
                .map((s, i) => ({
                    availability: true,
                    slot_number: s.slotNumber ?? (i + 1),
                    startTime: s.startTime || ""
                }));

            if (DEBUG) console.log(`[timeslots] ${loc.name} → ${slots.length} available slots`);
        }
        // ─── Fallback: parse calendar table ──────────
        else {
            const table = document.querySelector('table#rms_timeSelTable, table:has(.rms_timeSelTitle)');
            if (!table) {
                if (DEBUG) console.warn("No time selection table found");
                nextCentre();
                return;
            }

            // Get header row with dates
            const headerRow = table.querySelector('tr.rms_timeSelTitle');
            if (!headerRow) {
                if (DEBUG) console.warn("No date header row found");
                nextCentre();
                return;
            }

            const dateCells = Array.from(headerRow.querySelectorAll('th'));
            const dates = dateCells.map(th => {
                const span = th.querySelector('span.d');
                return span ? span.textContent.trim() : null;
            }).filter(Boolean); // e.g. ["Mon 23/02", "Tue 24/02", ...]

            // Get all time rows
            const timeRows = Array.from(table.querySelectorAll('tr[id^="rms_timeSel_"]'));

            timeRows.forEach((row, rowIdx) => {
                const timeCells = Array.from(row.querySelectorAll('td > a'));
                timeCells.forEach((a, colIdx) => {
                    if (!a.classList.contains('available')) return;

                    const timeStr = a.textContent.trim();           // "8:30 am"
                    const dateStr = dates[colIdx];                  // "Wed 26/02"
                    if (!dateStr || !timeStr) return;

                    // Convert "Wed 26/02" → "26/02/2026" (assuming current year or next)
                    let [dayOfWeek, ddmm] = dateStr.split(' ');
                    let [dd, mm] = ddmm.split('/');
                    let yyyy = new Date().getFullYear();
                    // If date is in past → assume next year
                    const thisYearDate = new Date(yyyy, mm-1, dd);
                    if (thisYearDate < new Date()) yyyy++;

                    const isoDate = `${dd.padStart(2,'0')}/${mm.padStart(2,'0')}/${yyyy}`;
                    const startTime = `${isoDate} ${timeStr.replace('am',' AM').replace('pm',' PM')}`;

                    slots.push({
                        availability: true,
                        slot_number: rowIdx + 1,  // Fixed: Use row index +1 as slot_number (centre's schedule position),
                        startTime: startTime
                    });

                    // Track earliest
                    if (!nextAvailable || startTime < nextAvailable) {
                        nextAvailable = startTime;
                    }
                });
            });

            if (DEBUG) console.log(`[DOM table] ${loc.name} → ${slots.length} available slots`);
        }

        // Save result
        results[loc.code] = [{
            location: loc.code,
            slots: slots,
            next_available_date: nextAvailable
        }];

        GM_setValue(S.data, results);
        setTimeout(nextCentre, 1800 + Math.random()*700);
    }

    function nextCentre() {
        let idx = GM_getValue(S.idx, 0) + 1;
        GM_setValue(S.idx, idx);
        navigateBack();
        setTimeout(processNext, 2200 + Math.random()*800);
    }

    function finish(data) {
        GM_setValue(S.active, false);
        status.style.display = 'none';

        const final = {
            results: Object.values(data).flat(),
            last_updated: new Date().toISOString()
        };

        const blob = new Blob([JSON.stringify(final, null, 2)], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'bookings.json';
        a.click();
        URL.revokeObjectURL(url);

        alert(`Finished!\n\n${final.results.length} locations saved to bookings.json`);
    }

    // Resume if page reloaded
    window.addEventListener('load', () => {
        if (GM_getValue(S.active, false)) {
            setTimeout(processNext, 1800);
        }
    });

})();

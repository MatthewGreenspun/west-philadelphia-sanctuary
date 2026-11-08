import { $, esc, initSite, getSite, hydrateIcons } from '../site.js';
import { icon } from '../config.js';

await initSite('about');
const { site, stats } = await getSite();

if (site.mission) $('#mission').textContent = site.mission;
$('#aboutText').innerHTML = (site.about || '').split(/\n\s*\n/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('');

$('#statSpaces').textContent = stats.spaces ?? 0;
$('#statEvents').textContent = stats.upcomingEvents ?? 0;
$('#statPhotos').textContent = stats.photos ?? 0;

if (site.meeting) {
  $('#meeting').textContent = site.meeting;
  $('#meetingBox').hidden = false;
}

const contact = [
  site.email ? `<div class="info-row">${icon('mail')}<a href="mailto:${esc(site.email)}">${esc(site.email)}</a></div>` : '',
  site.instagram ? `<div class="info-row">${icon('instagram')}<a href="${esc(site.instagram)}" target="_blank" rel="noopener">${esc(site.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\//, '@').replace(/\/$/, ''))}</a></div>` : '',
].join('');
if (contact) {
  $('#contact').innerHTML = contact;
  $('#contactBox').hidden = false;
}

const initials = (n) => n.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
if (site.team?.length) {
  $('#team').innerHTML = site.team.map((m) => `
    <div class="member">
      <span class="mem-photo">${m.photo ? `<img src="${esc(m.photo)}" alt="" loading="lazy" />` : esc(initials(m.name))}</span>
      <strong>${esc(m.name)}</strong>
      ${m.role ? `<small>${esc(m.role)}</small>` : ''}
      ${m.bio ? `<p>${esc(m.bio)}</p>` : ''}
    </div>`).join('');
  $('#teamSection').hidden = false;
}
hydrateIcons();

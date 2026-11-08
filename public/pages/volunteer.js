import { $, $$, esc, api, initSite, getSite, session, hydrateIcons } from '../site.js';
import { VOLUNTEER } from '../config.js';

await initSite('volunteer');

const form = $('#volForm');
$('#affiliation').insertAdjacentHTML('beforeend', Object.entries(VOLUNTEER.affiliation).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join(''));
const checks = (name, opts) => Object.entries(opts).map(([v, l]) => `<label><input type="checkbox" name="${name}" value="${v}" />${esc(l)}</label>`).join('');
$('#interests').innerHTML = checks('interests', VOLUNTEER.interests);
$('#availability').innerHTML = checks('availability', VOLUNTEER.availability);
if (session.user) form.name.value = session.user.name;

getSite().then(({ site }) => {
  const parts = [];
  if (site.boardForm) parts.push(`<a class="btn btn-outline btn-block" href="${esc(site.boardForm)}" target="_blank" rel="noopener">Apply to our executive board</a>`);
  if (site.mailingList) parts.push(`<a class="btn btn-outline btn-block" href="${esc(site.mailingList)}" target="_blank" rel="noopener">Join our email list</a>`);
  if (site.email) parts.push(`<p class="muted" style="margin:0">Questions? Email <a href="mailto:${esc(site.email)}">${esc(site.email)}</a>.</p>`);
  if (!parts.length) return;
  $('#volContact').innerHTML = `<h3>More ways to get involved</h3>${parts.join('')}`;
  $('#volContact').hidden = false;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#volError');
  const picked = (name) => $$(`input[name="${name}"]:checked`, form).map((i) => i.value);
  const body = {
    name: form.name.value, email: form.email.value, phone: form.phone.value, affiliation: form.affiliation.value,
    school: form.school.value, interests: picked('interests'), availability: picked('availability'),
    howHeard: form.howHeard.value, message: form.message.value, website: form.website.value,
  };
  if (!body.name.trim() || !form.email.checkValidity() || !body.email.trim()) {
    err.textContent = 'Please add your name and a valid email.';
    err.hidden = false;
    return;
  }
  if (!body.interests.length) {
    err.textContent = 'Pick at least one way you’d like to help.';
    err.hidden = false;
    $('#interests').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  $('#volSubmit').disabled = true;
  err.hidden = true;
  try {
    await api('/volunteers', { method: 'POST', body });
    form.hidden = true;
    $('#volDone').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  } finally {
    $('#volSubmit').disabled = false;
  }
});
hydrateIcons();

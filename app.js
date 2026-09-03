// ---------- Konfiguracja ----------

var GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
var FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
var STORAGE_KEY = 'pogodaMotoSettings_v1';

var RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]);

var DEFAULT_SETTINGS = {
  startName: 'Kluszkowce',
  endName: 'Nowy Targ',
  startLat: null, startLon: null, startLabel: '',
  endLat: null, endLon: null, endLabel: '',
  depMorning: '06:30',
  durMorning: 30,
  depAfternoon: '15:00',
  durAfternoon: 45,
  rainThreshold: 30
};

var WEATHER_CODES = {
  0: ['Bezchmurnie', '☀️'], 1: ['Głównie bezchmurnie', '🌤️'], 2: ['Częściowe zachmurzenie', '⛅'], 3: ['Zachmurzenie duże', '☁️'],
  45: ['Mgła', '🌫️'], 48: ['Mgła osadzająca szron', '🌫️'],
  51: ['Mżawka słaba', '🌦️'], 53: ['Mżawka', '🌦️'], 55: ['Mżawka silna', '🌦️'],
  56: ['Marznąca mżawka', '🌧️'], 57: ['Marznąca mżawka silna', '🌧️'],
  61: ['Deszcz słaby', '🌧️'], 63: ['Deszcz', '🌧️'], 65: ['Deszcz silny', '🌧️'],
  66: ['Marznący deszcz', '🌧️'], 67: ['Marznący deszcz silny', '🌧️'],
  71: ['Śnieg słaby', '🌨️'], 73: ['Śnieg', '🌨️'], 75: ['Śnieg silny', '🌨️'], 77: ['Ziarna śniegu', '🌨️'],
  80: ['Przelotny deszcz słaby', '🌦️'], 81: ['Przelotny deszcz', '🌧️'], 82: ['Przelotny deszcz silny', '🌧️'],
  85: ['Przelotny śnieg słaby', '🌨️'], 86: ['Przelotny śnieg silny', '🌨️'],
  95: ['Burza', '⛈️'], 96: ['Burza z gradem', '⛈️'], 99: ['Burza z gradem silna', '⛈️']
};

var cachedData = null;

// ---------- Ustawienia (localStorage) ----------

function loadSettings() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return Object.assign({}, DEFAULT_SETTINGS);
    return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
  } catch (e) {
    return Object.assign({}, DEFAULT_SETTINGS);
  }
}

function saveSettings(s) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

// ---------- Pomocnicze funkcje czasu ----------

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

function todayDateStr() {
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function timeToMinutes(t) {
  var parts = t.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function minutesToHourKey(dateStr, minutes) {
  var h = Math.round(minutes / 60);
  var dateToUse = dateStr;
  if (h >= 24) {
    h = h - 24;
    var d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    dateToUse = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  if (h < 0) h = 0;
  return dateToUse + 'T' + pad2(h) + ':00';
}

function weatherCodeInfo(code) {
  return WEATHER_CODES[code] || ['Nieznane', '❓'];
}

// ---------- Komunikacja z Open-Meteo ----------

function geocodeCity(name) {
  var url = GEOCODE_URL + '?name=' + encodeURIComponent(name) + '&count=1&language=pl&format=json';
  return fetch(url).then(function (res) {
    if (!res.ok) throw new Error('Błąd geokodowania miejscowości.');
    return res.json();
  }).then(function (data) {
    if (!data.results || data.results.length === 0) {
      throw new Error('Nie znaleziono miejscowości: ' + name);
    }
    var r = data.results[0];
    var parts = [r.name];
    if (r.admin1) parts.push(r.admin1);
    if (r.country) parts.push(r.country);
    return { lat: r.latitude, lon: r.longitude, label: parts.join(', ') };
  });
}

function fetchForecastPair(lat1, lon1, lat2, lon2) {
  var params = new URLSearchParams({
    latitude: lat1 + ',' + lat2,
    longitude: lon1 + ',' + lon2,
    hourly: 'temperature_2m,precipitation_probability,precipitation,weathercode,windspeed_10m',
    forecast_days: '2',
    timezone: 'auto'
  });
  return fetch(FORECAST_URL + '?' + params.toString()).then(function (res) {
    if (!res.ok) throw new Error('Błąd pobierania danych pogodowych.');
    return res.json();
  }).then(function (data) {
    return Array.isArray(data) ? data : [data];
  });
}

function findHourlyIndex(hourly, hourKey) {
  return hourly.time.indexOf(hourKey);
}

function extractPoint(locationData, hourKey) {
  var idx = findHourlyIndex(locationData.hourly, hourKey);
  if (idx === -1) return null;
  return {
    time: hourKey,
    temp: locationData.hourly.temperature_2m[idx],
    precipProb: locationData.hourly.precipitation_probability[idx],
    precip: locationData.hourly.precipitation[idx],
    code: locationData.hourly.weathercode[idx],
    wind: locationData.hourly.windspeed_10m[idx]
  };
}

// ---------- Logika decyzji: motor czy samochod ----------

function evaluateTrip(fromData, toData, depTime, durationMin, threshold) {
  var dateStr = todayDateStr();
  var depMinutes = timeToMinutes(depTime);
  var arrMinutes = depMinutes + parseInt(durationMin, 10);
  var depKey = minutesToHourKey(dateStr, depMinutes);
  var arrKey = minutesToHourKey(dateStr, arrMinutes);
  var depPoint = extractPoint(fromData, depKey);
  var arrPoint = extractPoint(toData, arrKey);

  if (!depPoint || !arrPoint) {
    return { ok: false, reason: 'Brak danych prognozy dla wybranej godziny (sprawdź, czy godziny mieszczą się w najbliższych 48h).' };
  }

  var reasons = [];
  var carRecommended = false;

  [{ p: depPoint, label: 'na starcie' }, { p: arrPoint, label: 'na mecie' }].forEach(function (item) {
    var p = item.p;
    var label = item.label;
    if (RAIN_CODES.has(p.code)) {
      carRecommended = true;
      reasons.push('Opady (' + weatherCodeInfo(p.code)[0].toLowerCase() + ') ' + label + ' o ' + p.time.substr(11, 5));
    } else if (p.precipProb >= threshold) {
      carRecommended = true;
      reasons.push('Ryzyko opadów ' + p.precipProb + '% ' + label + ' o ' + p.time.substr(11, 5));
    }
    if (p.temp <= 2) {
      carRecommended = true;
      reasons.push('Niska temperatura ' + p.temp + '°C ' + label + ' - możliwy lód');
    }
    if (p.wind >= 40) {
      carRecommended = true;
      reasons.push('Silny wiatr ' + Math.round(p.wind) + ' km/h ' + label);
    }
  });

  if (reasons.length === 0) {
    reasons.push('Bez opadów, temp. ' + depPoint.temp + '°C - ' + arrPoint.temp + '°C, wiatr do ' + Math.round(Math.max(depPoint.wind, arrPoint.wind)) + ' km/h');
  }

  return { ok: true, carRecommended: carRecommended, reasons: reasons, depPoint: depPoint, arrPoint: arrPoint };
}

// ---------- Renderowanie widoków ----------

function renderTripCard(containerId, titleText, fromLabel, toLabel, depTime, result) {
  var el = document.getElementById(containerId);
  if (!result.ok) {
    el.innerHTML = '<h2>' + titleText + '</h2><p class="error-text">' + result.reason + '</p>';
    return;
  }
  var verdictIcon = result.carRecommended ? '🚗' : '🏍️';
  var verdictText = result.carRecommended ? 'Jedź samochodem' : 'Jedź motorem';
  var verdictClass = result.carRecommended ? 'verdict-car' : 'verdict-moto';

  el.innerHTML =
    '<h2>' + titleText + '</h2>' +
    '<div class="route-line">' + fromLabel + ' → ' + toLabel + ', wyjazd ' + depTime + '</div>' +
    '<div class="verdict ' + verdictClass + '"><span class="verdict-icon">' + verdictIcon + '</span><span>' + verdictText + '</span></div>' +
    '<ul class="reasons">' + result.reasons.map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ul>' +
    '<div class="checkpoints">' +
    '<div class="checkpoint"><b>Start ' + result.depPoint.time.substr(11, 5) + '</b> ' + weatherCodeInfo(result.depPoint.code)[1] + ' ' + result.depPoint.temp + '°C, opady ' + result.depPoint.precipProb + '%</div>' +
    '<div class="checkpoint"><b>Meta ' + result.arrPoint.time.substr(11, 5) + '</b> ' + weatherCodeInfo(result.arrPoint.code)[1] + ' ' + result.arrPoint.temp + '°C, opady ' + result.arrPoint.precipProb + '%</div>' +
    '</div>';
}

function renderHourlyTable(containerId, label, locationData) {
  var dateStr = todayDateStr();
  var rows = '';
  for (var h = 5; h <= 21; h++) {
    var key = dateStr + 'T' + pad2(h) + ':00';
    var idx = findHourlyIndex(locationData.hourly, key);
    if (idx === -1) continue;
    var info = weatherCodeInfo(locationData.hourly.weathercode[idx]);
    rows += '<tr><td>' + pad2(h) + ':00</td><td>' + info[1] + ' ' + info[0] + '</td><td>' + locationData.hourly.temperature_2m[idx] + '°C</td><td>' + locationData.hourly.precipitation_probability[idx] + '%</td><td>' + Math.round(locationData.hourly.windspeed_10m[idx]) + ' km/h</td></tr>';
  }
  document.getElementById(containerId).innerHTML =
    '<h3>' + label + '</h3><table class="hourly-table"><thead><tr><th>Godz.</th><th>Pogoda</th><th>Temp.</th><th>Opady</th><th>Wiatr</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

// ---------- Glowna funkcja ladowania danych ----------

function loadAllWeather() {
  var settings = loadSettings();
  var homeStatus = document.getElementById('homeStatus');

  if (!settings.startLat || !settings.endLat) {
    homeStatus.textContent = 'Uzupełnij lokalizacje w zakładce Ustawienia.';
    document.getElementById('tripToWork').innerHTML = '';
    document.getElementById('tripHome').innerHTML = '';
    document.getElementById('weatherStart').innerHTML = '';
    document.getElementById('weatherEnd').innerHTML = '';
    return;
  }

  homeStatus.textContent = 'Pobieranie danych pogodowych...';

  fetchForecastPair(settings.startLat, settings.startLon, settings.endLat, settings.endLon).then(function (pair) {
    cachedData = { start: pair[0], end: pair[1] };
    homeStatus.textContent = '';

    var toWork = evaluateTrip(cachedData.start, cachedData.end, settings.depMorning, settings.durMorning, settings.rainThreshold);
    renderTripCard('tripToWork', 'Dojazd do pracy', settings.startName, settings.endName, settings.depMorning, toWork);

    var toHome = evaluateTrip(cachedData.end, cachedData.start, settings.depAfternoon, settings.durAfternoon, settings.rainThreshold);
    renderTripCard('tripHome', 'Powrót do domu', settings.endName, settings.startName, settings.depAfternoon, toHome);

    renderHourlyTable('weatherStart', settings.startName, cachedData.start);
    renderHourlyTable('weatherEnd', settings.endName, cachedData.end);

    document.getElementById('lastUpdate').textContent = 'Ostatnia aktualizacja: ' + new Date().toLocaleTimeString('pl-PL');
  }).catch(function (err) {
    homeStatus.textContent = 'Błąd: ' + err.message;
  });
}

// ---------- Ustawienia: formularz ----------

function fillSettingsForm() {
  var s = loadSettings();
  document.getElementById('startName').value = s.startName;
  document.getElementById('endName').value = s.endName;
  document.getElementById('depMorning').value = s.depMorning;
  document.getElementById('durMorning').value = s.durMorning;
  document.getElementById('depAfternoon').value = s.depAfternoon;
  document.getElementById('durAfternoon').value = s.durAfternoon;
  document.getElementById('rainThreshold').value = s.rainThreshold;

  var statusEl = document.getElementById('settingsStatus');
  if (s.startLabel && s.endLabel) {
    statusEl.textContent = 'Zapisane lokalizacje: ' + s.startLabel + ' / ' + s.endLabel;
    statusEl.className = 'status-msg status-ok';
  }
}

function handleSaveSettings(ev) {
  ev.preventDefault();
  var statusEl = document.getElementById('settingsStatus');
  statusEl.className = 'status-msg';
  statusEl.textContent = 'Zapisywanie i wyszukiwanie lokalizacji...';

  var current = loadSettings();
  var newStartName = document.getElementById('startName').value.trim();
  var newEndName = document.getElementById('endName').value.trim();

  var s = {
    startName: newStartName,
    endName: newEndName,
    depMorning: document.getElementById('depMorning').value,
    durMorning: parseInt(document.getElementById('durMorning').value, 10) || 0,
    depAfternoon: document.getElementById('depAfternoon').value,
    durAfternoon: parseInt(document.getElementById('durAfternoon').value, 10) || 0,
    rainThreshold: parseInt(document.getElementById('rainThreshold').value, 10),
    startLat: current.startLat, startLon: current.startLon, startLabel: current.startLabel,
    endLat: current.endLat, endLon: current.endLon, endLabel: current.endLabel
  };
  if (isNaN(s.rainThreshold)) s.rainThreshold = 30;

  var needStart = (newStartName !== current.startName) || !current.startLat;
  var needEnd = (newEndName !== current.endName) || !current.endLat;

  Promise.resolve().then(function () {
    if (needStart) return geocodeCity(newStartName).then(function (g) {
      s.startLat = g.lat; s.startLon = g.lon; s.startLabel = g.label;
    });
  }).then(function () {
    if (needEnd) return geocodeCity(newEndName).then(function (g) {
      s.endLat = g.lat; s.endLon = g.lon; s.endLabel = g.label;
    });
  }).then(function () {
    saveSettings(s);
    statusEl.textContent = 'Zapisano: ' + s.startLabel + ' → ' + s.endLabel;
    statusEl.className = 'status-msg status-ok';
    loadAllWeather();
  }).catch(function (err) {
    statusEl.textContent = 'Błąd: ' + err.message;
    statusEl.className = 'status-msg status-error';
  });
}

// ---------- Nawigacja (tabbar) ----------

function initTabs() {
  var btns = document.querySelectorAll('.tab-btn');
  btns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      btns.forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById(btn.dataset.view).classList.add('active');
    });
  });
}

// ---------- Start aplikacji ----------

window.addEventListener('load', function () {
  initTabs();
  fillSettingsForm();
  loadAllWeather();

  document.getElementById('refreshBtn').addEventListener('click', loadAllWeather);
  document.getElementById('settingsForm').addEventListener('submit', handleSaveSettings);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(function () {});
  }
});

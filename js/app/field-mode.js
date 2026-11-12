/* Field workflow: environmental context and repeatable listening-position snapshots. */
(function (global) {
  'use strict';
  const API = 'https://bernaudio-ai.eddyflores100.workers.dev/api/environment';
  const el = id => document.getElementById(id);
  const numberOrNull = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

  const FIELD = {
    points: [], weather: null, location: null, _busy: false,
    init() {
      this.ui = {
        event: el('fieldEvent'), zone: el('fieldZone'), includeGps: el('fieldIncludeGps'),
        weatherButton: el('fieldWeatherRefresh'), weatherStatus: el('fieldWeatherStatus'),
        weatherGrid: el('fieldWeatherGrid'), saveButton: el('fieldSavePoint'),
        resetButton: el('fieldResetLevel'), clearButton: el('fieldClearPoints'),
        pointCount: el('fieldPointCount'), list: el('fieldPointList'), note: el('fieldStatus')
      };
      if (!this.ui.event || !this.ui.zone) return;
      this.ui.weatherButton.addEventListener('click', () => this.refreshWeather());
      this.ui.saveButton.addEventListener('click', () => this.savePoint());
      this.ui.resetButton.addEventListener('click', () => {
        global.MOD_SPL?.reset();
        this.status('Intervalo SPL reiniciado. Toma una nueva lectura antes de registrar otra zona.');
      });
      this.ui.clearButton.addEventListener('click', () => {
        this.points = []; this.renderPoints();
        this.status('Lista de zonas vaciada. Las mediciones originales del analizador no se modificaron.');
      });
      this.ui.zone.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); this.savePoint(); }
      });
      this.renderPoints();
      this.renderWeather();
    },
    status(message) { if (this.ui?.note) this.ui.note.textContent = message; },
    async getLocation() {
      if (!global.navigator?.geolocation) throw new Error('Este navegador no ofrece geolocalización. Puedes seguir midiendo sin GPS.');
      const position = await new Promise((resolve, reject) => {
        global.navigator.geolocation.getCurrentPosition(resolve,
          error => reject(new Error(error?.code === 1 ? 'No se concedió permiso de ubicación.' : 'No se pudo obtener la ubicación.')),
          { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 });
      });
      this.location = {
        latitude: numberOrNull(position.coords.latitude),
        longitude: numberOrNull(position.coords.longitude),
        accuracyMeters: numberOrNull(position.coords.accuracy),
        capturedAt: new Date().toISOString()
      };
      if (this.location.latitude == null || this.location.longitude == null) throw new Error('La ubicación recibida no es válida.');
      return this.location;
    },
    async refreshWeather(options = {}) {
      if (this._busy) return;
      this._busy = true;
      this.ui.weatherButton.disabled = true;
      this.ui.weatherButton.textContent = 'Consultando…';
      if (!options.silent) this.ui.weatherStatus.textContent = 'Solicitando ubicación y condiciones ambientales…';
      try {
        const location = await this.getLocation();
        const url = API + '?lat=' + encodeURIComponent(location.latitude) + '&lon=' + encodeURIComponent(location.longitude);
        const response = await fetch(url, { method: 'GET', headers: { accept: 'application/json' } });
        let payload = {};
        try { payload = await response.json(); } catch (_) {}
        if (!response.ok) {
          if (response.status === 503 && payload.code === 'weather_not_configured') {
            throw new Error('La ubicación está lista, pero falta configurar WEATHERAPI_KEY en el Worker de Cloudflare.');
          }
          throw new Error(payload.error || 'El servicio ambiental no respondió correctamente.');
        }
        this.weather = payload;
        this.renderWeather();
        if (!options.silent) this.status('Condiciones ambientales actualizadas. Se adjuntarán a las próximas zonas que registres.');
        return this.weather;
      } catch (error) {
        this.ui.weatherStatus.textContent = error.message || 'No se pudo consultar el ambiente.';
        if (!options.silent) this.status(error.message || 'No se pudo actualizar el ambiente.');
        return null;
      } finally {
        this._busy = false;
        this.ui.weatherButton.disabled = false;
        this.ui.weatherButton.textContent = 'Actualizar ambiente';
      }
    },
    makeSpectrumSnapshot() {
      const rta = global.MOD_RTA;
      if (!rta?.bands?.length || !rta?.disp) return null;
      const bands = [];
      const stride = Math.max(1, Math.ceil(rta.bands.length / 96));
      for (let i = 0; i < rta.bands.length; i += stride) {
        const level = Number(rta.disp[i]);
        bands.push({ centerHz: numberOrNull(rta.bands[i]?.fc), levelDb: Number.isFinite(level) ? level : null });
      }
      return {
        weighting: rta.el?.rtaWeight?.value || 'Z',
        resolutionPerOctave: numberOrNull(rta.el?.rtaRes?.value),
        bands
      };
    },
    async savePoint() {
      if (!global.AE?.running) {
        this.status('Inicia la captura de audio antes de registrar una zona.');
        return false;
      }
      const zone = String(this.ui.zone.value || '').trim().slice(0, 48);
      if (!zone) {
        this.status('Escribe una posición, por ejemplo: FOH, centro, lateral izquierdo o fondo.');
        this.ui.zone.focus();
        return false;
      }
      const level = global.MOD_SPL?.snapshot?.();
      if (!level || !Number.isFinite(level.durationSeconds) || level.durationSeconds < 1.5) {
        this.status('Necesitas al menos 1.5 segundos de captura SPL para guardar una lectura representativa.');
        return false;
      }
      if (this.location && this.weather && Date.now() - Date.parse(this.weather.capturedAt || '') > 10 * 60 * 1000)
        await this.refreshWeather({ silent: true });
      const tf = global.MOD_TF;
      const comparison = tf?._comparisonStats?.();
      const point = {
        id: 'zone-' + Date.now() + '-' + (this.points.length + 1),
        zone,
        capturedAt: new Date().toISOString(),
        audio: {
          sampleRate: numberOrNull(global.AE.sampleRate),
          channels: numberOrNull(global.AE.realChannels),
          fftSize: numberOrNull(global.AE.fftSize),
          backend: String(global.AE.backend || 'unknown')
        },
        level: {
          weighting: level.weighting, durationSeconds: numberOrNull(level.durationSeconds),
          leqDb: numberOrNull(level.leqDb), minDb: numberOrNull(level.minDb),
          maxDb: numberOrNull(level.maxDb), peakDb: numberOrNull(level.peakDb),
          calibrated: !!level.calibrated, offsetDb: numberOrNull(level.offsetDb)
        },
        spectrum: this.makeSpectrumSnapshot(),
        transferFunction: comparison ? {
          meanDeltaDb: numberOrNull(comparison.meanDeltaDb),
          maxAbsDeltaDb: numberOrNull(comparison.maxAbsDeltaDb),
          meanCoherence: numberOrNull(comparison.meanCoherence),
          bins: numberOrNull(comparison.bins)
        } : null,
        environment: this.weather ? JSON.parse(JSON.stringify(this.weather)) : null,
        location: this.ui.includeGps.checked && this.location ? { ...this.location } : null
      };
      this.points.push(point);
      this.renderPoints();
      this.status('Zona "' + zone + '" registrada. Restablece el intervalo SPL antes de medir el siguiente punto.');
      return true;
    },
    renderWeather() {
      if (!this.ui) return;
      const grid = this.ui.weatherGrid;
      grid.replaceChildren();
      if (!this.weather) {
        const message = document.createElement('p');
        message.className = 'field-muted';
        message.textContent = 'Sin datos ambientales todavía. Actualiza para consultar presión, temperatura, humedad y viento.';
        grid.append(message);
        return;
      }
      const w = this.weather.conditions || {};
      const place = [this.weather.location?.name, this.weather.location?.region, this.weather.location?.country].filter(Boolean).join(', ');
      this.ui.weatherStatus.textContent = (place ? place + ' · ' : '') + 'Actualizado ' + new Date(this.weather.capturedAt).toLocaleTimeString();
      const values = [
        ['Presión', w.pressureHpa, 'hPa'],
        ['Temperatura', w.temperatureC, '°C'],
        ['Humedad', w.humidityPct, '%'],
        ['Viento', w.windKph, 'km/h'],
        ['Dirección', w.windDirection, ''],
        ['Ráfagas', w.gustKph, 'km/h']
      ];
      for (const [label, value, unit] of values) {
        const card = document.createElement('div');
        card.className = 'field-weather-value';
        const name = document.createElement('span'); name.textContent = label;
        const number = document.createElement('strong');
        number.textContent = value == null ? '—' : (typeof value === 'number' ? value.toFixed(label === 'Presión' ? 1 : 0) : String(value)) + (unit ? ' ' + unit : '');
        card.append(name, number); grid.append(card);
      }
    },
    renderPoints() {
      if (!this.ui) return;
      this.ui.pointCount.textContent = String(this.points.length);
      this.ui.list.replaceChildren();
      if (!this.points.length) {
        const empty = document.createElement('p');
        empty.className = 'field-muted';
        empty.textContent = 'Todavía no hay zonas registradas. Mide en una posición y guarda el punto para comparar la cobertura.';
        this.ui.list.append(empty);
        return;
      }
      const baseline = this.points[0].level?.leqDb;
      this.points.forEach((point, index) => {
        const card = document.createElement('article');
        card.className = 'field-point';
        const header = document.createElement('div'); header.className = 'field-point-head';
        const title = document.createElement('strong'); title.textContent = (index + 1) + '. ' + point.zone;
        const time = document.createElement('time'); time.dateTime = point.capturedAt;
        time.textContent = new Date(point.capturedAt).toLocaleTimeString();
        header.append(title, time);
        const stats = document.createElement('div'); stats.className = 'field-point-stats';
        const leq = document.createElement('span');
        leq.textContent = 'Leq ' + (Number.isFinite(point.level?.leqDb) ? point.level.leqDb.toFixed(1) + ' dB' : '—');
        const delta = document.createElement('span');
        const difference = Number.isFinite(point.level?.leqDb) && Number.isFinite(baseline) ? point.level.leqDb - baseline : null;
        delta.textContent = index === 0 ? 'Referencia' : difference == null ? 'Δ —' : 'Δ ' + (difference > 0 ? '+' : '') + difference.toFixed(1) + ' dB vs. primer punto';
        const calibrated = document.createElement('span');
        calibrated.textContent = point.level?.calibrated ? 'Offset declarado' : 'Nivel relativo / sin calibrar';
        stats.append(leq, delta, calibrated);
        card.append(header, stats);
        if (point.environment?.conditions) {
          const env = point.environment.conditions;
          const line = document.createElement('p'); line.className = 'field-point-env';
          line.textContent = 'Ambiente: ' + (env.temperatureC == null ? '—' : env.temperatureC + ' °C') +
            ' · ' + (env.pressureHpa == null ? '—' : env.pressureHpa + ' hPa') +
            ' · viento ' + (env.windKph == null ? '—' : env.windKph + ' km/h');
          card.append(line);
        }
        if (point.location) {
          const gps = document.createElement('p'); gps.className = 'field-point-env';
          gps.textContent = 'GPS ±' + (point.location.accuracyMeters == null ? '—' : Math.round(point.location.accuracyMeters) + ' m');
          card.append(gps);
        }
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'btn btn-sm field-remove';
        remove.textContent = 'Quitar zona'; remove.addEventListener('click', () => {
          this.points = this.points.filter(item => item.id !== point.id); this.renderPoints();
        });
        card.append(remove); this.ui.list.append(card);
      });
    },
    exportData() {
      return {
        schemaVersion: 1, eventName: String(this.ui?.event.value || '').trim().slice(0, 80),
        points: this.points.map(point => JSON.parse(JSON.stringify(point)))
      };
    },
    importData(data) {
      if (!data) { this.points = []; this.renderPoints(); return; }
      if (data.schemaVersion !== 1 || typeof data.eventName !== 'string' ||
          !Array.isArray(data.points) || data.points.length > 80) throw new Error('Datos de zonas no válidos.');
      const points = data.points.map(point => {
        if (!point || typeof point.zone !== 'string' || point.zone.length > 48 ||
            typeof point.capturedAt !== 'string' || !point.level || typeof point.level !== 'object' ||
            (point.level.leqDb != null && !Number.isFinite(point.level.leqDb)))
          throw new Error('Un punto de medición está dañado.');
        return JSON.parse(JSON.stringify(point));
      });
      this.ui.event.value = data.eventName.slice(0, 80);
      this.points = points; this.renderPoints();
    },
    context() {
      return { eventName: String(this.ui?.event.value || '').slice(0, 80),
        pointCount: this.points.length,
        recentZones: this.points.slice(-5).map(point => ({
          zone: point.zone, leqDb: point.level?.leqDb ?? null,
          calibrated: !!point.level?.calibrated, temperatureC: point.environment?.conditions?.temperatureC ?? null,
          windKph: point.environment?.conditions?.windKph ?? null
        })) };
    }
  };

  global.FIELD = FIELD;
  document.addEventListener('DOMContentLoaded', () => FIELD.init(), { once: true });
})(window);

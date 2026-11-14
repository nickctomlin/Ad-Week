// Requested only after the visitor presses My location. Coordinates stay in memory.
export function getCurrentLocation({ geolocation = globalThis.navigator?.geolocation, secure = globalThis.isSecureContext } = {}) {
  if (!secure) return Promise.reject(new Error('Location needs a secure connection. Open Ad Week over HTTPS (or localhost), then try again.'));
  if (!geolocation?.getCurrentPosition) return Promise.reject(new Error('Location is not available in this browser. You can still explore the restaurant map.'));
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(({ coords }) => {
      const { latitude: lat, longitude: lng, accuracy } = coords;
      if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180 || !Number.isFinite(accuracy) || accuracy < 0) {
        reject(new Error('Your device returned an invalid location. Please try again.'));
        return;
      }
      resolve({ lat, lng, accuracy });
    }, (error) => {
      const messages = {
        1: 'Location access is off. Allow location for this site in your browser settings, then try again.',
        2: 'Your device could not find a location. Check that location services are enabled and try again.',
        3: 'Finding your location took too long. Please try again.',
      };
      reject(new Error(messages[error.code] || 'Your location could not be found. Please try again.'));
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
}

export function formatLocationAccuracy(metres) {
  return metres < 1000 ? `${Math.max(1, Math.round(metres))} m` : `${(metres / 1000).toFixed(1)} km`;
}

export function placeUserLocation(L, map, position, { marker, accuracy, center = true } = {}) {
  const point = [position.lat, position.lng];
  marker?.remove();
  accuracy?.remove();
  accuracy = L.circle(point, { radius: position.accuracy, color: 'var(--map-location)', weight: 1, opacity: .5, fillOpacity: .1, interactive: false }).addTo(map);
  marker = L.marker(point, { title: 'Your location', alt: 'Your location', zIndexOffset: 1000,
    icon: L.divIcon({ className: 'special-user-marker', html: '<span aria-hidden="true"></span>', iconSize: [24, 24], iconAnchor: [12, 12] }),
  }).addTo(map).bindTooltip(`Your location · accuracy about ${formatLocationAccuracy(position.accuracy)}`);
  if (center) {
    map.invalidateSize();
    if (position.accuracy > 1000) map.fitBounds(accuracy.getBounds(), { padding: [24, 24], maxZoom: 15 });
    else map.setView(point, 15);
  }
  return { marker, accuracy };
}

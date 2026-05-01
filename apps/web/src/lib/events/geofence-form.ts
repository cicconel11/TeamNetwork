/** Shared shape from new/edit event forms (geofence section). */

export interface GeofenceFormFields {
  geofence_enabled: boolean;
  geofence_radius_m: number;
  geofence_latitude: string;
  geofence_longitude: string;
}

export interface GeofenceDbFields {
  geofence_enabled: boolean;
  geofence_radius_m: number;
  latitude: number | null;
  longitude: number | null;
}

/** Normalizes checkbox + coordinate strings for DB insert/update (mobile parity). */
export function geofenceFormToDbFields(fields: GeofenceFormFields): GeofenceDbFields {
  if (!fields.geofence_enabled) {
    return {
      geofence_enabled: false,
      geofence_radius_m: fields.geofence_radius_m,
      latitude: null,
      longitude: null,
    };
  }
  const lat = Number(fields.geofence_latitude.trim());
  const lng = Number(fields.geofence_longitude.trim());
  return {
    geofence_enabled: true,
    geofence_radius_m: fields.geofence_radius_m,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
  };
}

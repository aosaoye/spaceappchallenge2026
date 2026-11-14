export type CoordinateType = "ra" | "dec";

/**
 * Convierte una coordenada en formato sexagesimal (ej. "16h32m40.230s", "+66d45m17.90s",
 * "08:55:10.831") o en grados decimales ("248.167625", "-7.245147") a grados decimales (ICRS).
 * Lanza un Error descriptivo si el formato o el rango son inválidos.
 */
export function parseSexagesimal(
  input: string,
  type: CoordinateType
): number {
  const value = input.trim();

  if (!value) {
    throw new Error("Coordenada vacía");
  }

  // Detectar si es formato sexagesimal (h, d, m, s, °, ', ", :)
  const isSexagesimal = /[hHdDmMsS:°'″′"]/.test(value);

  if (!isSexagesimal) {
    const decimal = Number(value);

    if (!Number.isFinite(decimal)) {
      throw new Error("Coordenada decimal inválida");
    }

    if (type === "ra" && (decimal < 0 || decimal >= 360)) {
      throw new Error("RA fuera de rango (debe estar entre 0° y <360°)");
    }

    if (type === "dec" && (decimal < -90 || decimal > 90)) {
      throw new Error("DEC fuera de rango (debe estar entre -90° y +90°)");
    }

    return decimal;
  }

  const values = value.match(/\d+(?:\.\d*)?/g);

  if (!values || values.length < 2 || values.length > 3) {
    throw new Error("Formato sexagesimal inválido");
  }

  const sign = value.startsWith("-") ? -1 : 1;

  const major = Number(values[0]);
  const minutes = Number(values[1]);
  const seconds = Number(values[2] ?? 0);

  if (
    !Number.isFinite(major) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds) ||
    minutes >= 60 ||
    seconds >= 60
  ) {
    throw new Error("Minutos o segundos inválidos");
  }

  const magnitude = Math.abs(major) + minutes / 60 + seconds / 3600;

  if (type === "ra") {
    // Si viene expresada en horas (h/m/s o dos puntos), el rango es [0, 24) h y se multiplica por 15
    const usesDegreeUnit = /[dD°]/.test(value) && !/[hH]/.test(value);
    if (usesDegreeUnit) {
      if (sign < 0 || magnitude >= 360) {
        throw new Error("RA fuera de rango");
      }
      return magnitude;
    }

    if (sign < 0 || magnitude >= 24) {
      throw new Error("RA fuera de rango");
    }

    return magnitude * 15;
  }

  if (magnitude > 90) {
    throw new Error("DEC fuera de rango");
  }

  return sign * magnitude;
}

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const SHORT_MONTH_NAMES = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
];

/**
 * Agrupa una lista de registros (documentos o logs de auditoría) jerárquicamente por:
 * 1. Mes (ej: "Noviembre 2026")
 * 2. Semana del mes con su rango de fechas exacto (ej: "Semana 2 · 08 Nov – 14 Nov, 2026")
 *
 * Regla clave: Si en un mes o en una semana específica no se subió/registró nada,
 * esa semana o mes NO aparece en la estructura devuelta.
 */
export function groupItemsByMonthAndWeek(items = [], dateField = 'created_at') {
  const monthsMap = new Map();

  items.forEach((item) => {
    const rawDate = item?.[dateField];
    const d = rawDate ? new Date(rawDate) : new Date();
    const validDate = isNaN(d.getTime()) ? new Date() : d;

    const year = validDate.getFullYear();
    const monthIdx = validDate.getMonth(); // 0 - 11
    const day = validDate.getDate(); // 1 - 31

    const monthKey = `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
    const monthLabel = `${MONTH_NAMES[monthIdx]} ${year}`;
    const shortMonth = SHORT_MONTH_NAMES[monthIdx];

    // Calcular Semana del Mes (1 a 5) y su rango exacto dentro del mes
    const weekNumber = Math.ceil(day / 7);
    const startDay = (weekNumber - 1) * 7 + 1;
    const lastDayOfMonth = new Date(year, monthIdx + 1, 0).getDate();
    const endDay = Math.min(weekNumber * 7, lastDayOfMonth);

    const startStr = String(startDay).padStart(2, '0');
    const endStr = String(endDay).padStart(2, '0');

    const weekKey = `${monthKey}-W${weekNumber}`;
    const weekTitle = `Semana ${weekNumber}`;
    const weekRange = `Del ${startStr} ${shortMonth} al ${endStr} ${shortMonth}, ${year}`;

    if (!monthsMap.has(monthKey)) {
      monthsMap.set(monthKey, {
        monthKey,
        monthLabel,
        year,
        monthIdx,
        totalItems: 0,
        weeksMap: new Map()
      });
    }

    const monthEntry = monthsMap.get(monthKey);
    monthEntry.totalItems += 1;

    if (!monthEntry.weeksMap.has(weekKey)) {
      monthEntry.weeksMap.set(weekKey, {
        weekKey,
        weekNumber,
        weekTitle,
        weekRange,
        items: []
      });
    }

    monthEntry.weeksMap.get(weekKey).items.push(item);
  });

  // Ordenar meses del más reciente al más antiguo, y semanas de la más reciente a la más antigua
  const sortedMonths = Array.from(monthsMap.values())
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey))
    .map((m) => {
      const weeks = Array.from(m.weeksMap.values())
        .filter((w) => w.items.length > 0) // Omitir semanas vacías
        .sort((a, b) => b.weekNumber - a.weekNumber);

      return {
        monthKey: m.monthKey,
        monthLabel: m.monthLabel,
        totalItems: m.totalItems,
        weeks
      };
    })
    .filter((m) => m.weeks.length > 0);

  return sortedMonths;
}


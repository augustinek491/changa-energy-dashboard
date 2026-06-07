/**
 * Changa Energy — Shared TypeScript interfaces
 * =============================================
 * Types for LIVOLTEK Portal API and Huawei FusionSolar Northbound API responses.
 */

// ── LIVOLTEK Types ─────────────────────────────────────────────────────────────

export interface LivoltkEnv {
  LIVOLTEK_PORTAL_EMAIL: string;
  LIVOLTEK_PORTAL_PASSWORD: string;
  LIVOLTEK_ACCOUNT_TYPE: string;
  LIVOLTEK_NBP_BASE?: string;
  LIVOLTEK_CTRL_BASE?: string;
}

export interface LivoltkLoginResponse {
  msg_code: string;
  data?: {
    access_token: string;
    session_expiry_time?: number;
  };
}

/** Fleet-level live power and energy totals — from /powerstation/stationStateEnergy */
export interface FleetLive {
  currentPower: number | null;
  currentPowerUnit: string;
  todayGenerate: number | null;
  todayGenerateUnit: string;
  thisMonthGenerate: number | null;
  thisYearGenerate: number | null;
  totalGenerate: number | null;
  installedCapacity: number | null;
  installedCapacityUnit: string;
}

/** Fleet device counts — from /powerstation/totalCount */
export interface FleetCounts {
  pCount: number;
  onlineCount: number;
  offlineCount: number;
  alarmCount: number;
  pOnlineCount: number;
  eCount: number;
}

/** Fleet KPI card — from /customer/customerData */
export interface FleetKpi {
  name: string;
  data: number | string;
  dataUnit: string;
}

/** Per-site entry from findAllByCustomer */
export interface SiteSummary {
  id: number;
  name: string;
  systemType: number;
  status: number; // 1=online, 2=offline, 4=alarm
  batterySOC: number | null;
  pvPower: number | null;
  eoutDaily: number | null;
  eoutDailyUnit: string;
  eoutMonth: number | null;
  eoutMonthUnit: string;
  gridActivePower: number | null;
  gridActivePowerUnit: string;
  pvCapacity: number | null;
  latitude: number | null;
  longitude: number | null;
  totalCharging: number | null;
  totalDischarging: number | null;
  adress: string;
}

/** Full per-site live telemetry — from /powerstation/findOne */
export interface SiteLive {
  id: number;
  name: string;
  status: number;
  pvPower: number | null;
  loadPower: number | null;
  batteryPower: number | null;
  batterySOC: number | null;
  batteryCapacity: number | null;
  batteryVoltage: number | null;
  gridActivePower: number | null;
  acOutPower: number | null;
  todayPowerGeneration: number | null;
  monthPowerGeneration: number | null;
  totalPowerGeneration: number | null;
  carbonReduction: number | null;
  pvCapacity: number | null;
  latitude: number | null;
  longitude: number | null;
  adress: string;
  updateTimeZone: string;
  _error?: string;
}

/** Single data point from time series endpoints */
export interface TimeSeriesPoint {
  datetime: string;
  avgValue?: number | null;
  value?: number | null;
  original?: boolean;
}

/** Named series with array of data points */
export interface NamedSeries {
  name: string;
  key?: string;
  value: TimeSeriesPoint[];
}

/** Intraday 5-min data — keyed by channel name */
export type IntradayData = Record<string, TimeSeriesPoint[]>;

/** Alarm entry */
export interface Alarm {
  title: string;
  content: string;
  level: number;
  levelI18nMap?: Record<string, string>;
  originTimeString: string;
  powerStaitionName: string;
  status: number;
  alarmCode: string;
  actingTimeString: string;
}


// ── FusionSolar Types ──────────────────────────────────────────────────────────

export interface FusionSolarEnv {
  FUSIONSOLAR_USERNAME: string;
  FUSIONSOLAR_PASSWORD: string;
  FUSIONSOLAR_BASE_URL: string;
}

/** Station definition used in STATIONS list */
export interface StationDef {
  code: string;
  name: string;
  location: string;
}

/** FusionSolar generic API response envelope */
export interface FusionSolarResponse<T = unknown> {
  success?: boolean;
  failCode?: number;
  message?: string;
  data?: T;
  params?: unknown;
}

/** Station real-time KPI — from getStationRealKpi dataItemMap */
export interface StationRealKpi {
  day_power?: number;
  month_power?: number;
  total_power?: number;
  real_health_state?: number; // 1=disconnected, 2=faulty, 3=healthy
  day_income?: number;
}

/** Device entry — from getDevList */
export interface DeviceEntry {
  id: number;
  devName: string;
  devTypeId: number; // 1=inverter
  devStatus: number;
  stationCode: string;
}

/** Device real-time KPI — from getDevRealKpi dataItemMap */
export interface DeviceRealKpi {
  active_power?: number;
  day_cap?: number;
  mppt_power?: number;
  temperature?: number;
}

/** Station list entry — from getStationList */
export interface StationListEntry {
  stationCode: string;
  stationName: string;
  capacity?: number;
  gridConnectedTime?: string;
  latitude?: number;
  longitude?: number;
}

/** Assembled dashboard-ready record for a single station */
export interface StationDashboardRecord {
  name: string;
  loc: string;
  day: number;       // today's yield kWh
  total: number;     // lifetime yield kWh
  month: number;     // this month's yield kWh
  health: number;    // 1=disconnected, 2=faulty, 3=healthy
  live: number | null;         // live inverter output kW (PV generation)
  temperature: number | null;  // ambient temp °C from EMI weather sensor
  irradiance: number | null;   // live solar irradiance W/m² from EMI sensor (0 at night)

  // Grid / load / battery — populated only when the hardware is connected to FusionSolar.
  // Returns null when no smart meter or battery is registered at the station.
  gridPower:    number | null;  // grid power kW: positive = importing, negative = exporting
  loadPower:    number | null;  // site load kW — from meter if present, else calculated (PV + import − export)
  batterySOC:   number | null;  // battery state of charge 0–100 %
  batteryPower: number | null;  // battery power kW: positive = charging, negative = discharging
}

/**
 * Smart meter / grid meter real-time KPI — from getDevRealKpi (devTypeId=17).
 */
export interface SmartMeterKpi {
  active_power?:       number;
  forward_active_cap?: number;
  reverse_active_cap?: number;
  active_cap?:         number;
  power_factor?:       number;
  ab_phase_voltage?:   number;
  bc_phase_voltage?:   number;
  ca_phase_voltage?:   number;
  a_phase_current?:    number;
  b_phase_current?:    number;
  c_phase_current?:    number;
}

/**
 * Battery / ESS real-time KPI — from getDevRealKpi (devTypeId=39).
 */
export interface BatteryKpi {
  battery_soc?:          number;
  ch_discharge_power?:   number;
  battery_temperature?:  number;
  max_charge_power?:     number;
  max_discharge_power?:  number;
  rated_capacity?:       number;
  battery_status?:       number;
}

/**
 * Weather/irradiance sensor (EMI device, typeId=10).
 */
export interface StationWeather {
  stationCode: string;
  devId: number;
  temperature: number | null;
  pvTemperature: number | null;
  irradianceLive: number | null;
  irradianceTotal: number | null;
  runState: number;
}

/**
 * Daily PV yield record — from getKpiStationDay.
 */
export interface StationKpiDayRecord {
  collectTime: number;
  date: string;                 // "YYYY-MM-DD"
  stationCode: string;
  pvYield: number;
  radiationIntensity: number;
  inverterPower: number;
  co2Reduction: number;
  coalReduction: number;
  treeEquivalent: number;
}

/**
 * Hourly PV yield record — from getKpiStationHour (undocumented Northbound endpoint).
 * Returns 24 records per station per day (one per hour UTC).
 * inverterPower is kWh generated in that hour ≈ average kW for that hour.
 */
export interface StationKpiHourRecord {
  collectTime: number;  // unix ms — exact hour boundary (UTC)
  hour: string;         // ISO timestamp e.g. "2026-06-04T09:00:00.000Z"
  stationCode: string;
  inverterPower: number | null;   // kWh in this hour (null = nighttime / no data)
  radiationIntensity: number | null; // kWh/m² solar irradiance
}

/**
 * Monthly PV yield record — from getKpiStationMonth.
 */
export interface StationKpiMonthRecord {
  collectTime: number;
  yearMonth: string;            // "YYYY-MM"
  stationCode: string;
  pvYield: number;
  radiationIntensity: number;
  co2Reduction: number;
  coalReduction: number;
  treeEquivalent: number;
}

/**
 * Annual PV yield record — from getKpiStationYear.
 */
export interface StationKpiYearRecord {
  collectTime: number;
  year: string;                 // "YYYY"
  stationCode: string;
  pvYield: number;
  radiationIntensity: number;
  co2Reduction: number;
  coalReduction: number;
  treeEquivalent: number;
}

/**
 * Active alarm entry — from getAlarmList.
 */
export interface FusionSolarAlarm {
  alarmId: number;
  stationCode: string;
  stationName: string;
  deviceName: string;
  alarmName: string;
  alarmCode: number;
  alarmType: number;
  causeId: number;
  alarmCause: string;
  repairSuggestion: string;
  lv: number;                   // severity: 1=critical, 2=major, 3=minor, 4=warning
  raiseTime: number;            // unix ms timestamp
}

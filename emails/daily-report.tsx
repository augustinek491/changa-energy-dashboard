import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Row,
  Column,
  Heading,
  Text,
  Hr,
} from '@react-email/components';

export interface ReportStation {
  name: string;
  source: string;
  location: string | null;
  status: 'online' | 'alarm' | 'offline';
  pv_power_kw: number | null;
  today_kwh: number | null;
  month_kwh: number | null;
}

export interface ReportAlarm {
  station_name: string;
  alarm_name: string | null;
  severity: string | null;
  raised_at: string;
}

export interface DailyReportProps {
  date: string;
  generatedAt: string;
  summary: {
    total: number;
    online: number;
    alarm: number;
    offline: number;
    open_alarms: number;
    total_pv_kw: number;
    total_today_kwh: number;
    total_month_kwh: number;
    total_lifetime_kwh: number;
  };
  stations: ReportStation[];
  alarms: ReportAlarm[];
}

const ACCENT = '#17a655';
const SURFACE = '#FFFFFF';
const BG = '#F8FAFC';
const BORDER = '#E2E8F0';
const TEXT_PRIMARY = '#0F172A';
const TEXT_SECONDARY = '#64748B';
const TEXT_MUTED = '#94A3B8';

function statusColor(s: string) {
  if (s === 'online') return '#17a655';
  if (s === 'alarm') return '#F59E0B';
  return '#EF4444';
}

function statusLabel(s: string) {
  if (s === 'online') return 'Online';
  if (s === 'alarm') return 'Alarm';
  return 'Offline';
}

export function DailyReport({ date, generatedAt, summary, stations, alarms }: DailyReportProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>
        {`Changa Energy · ${date} · ${summary.total_today_kwh.toFixed(1)} kWh generated · ${summary.online}/${summary.total} stations online`}
      </Preview>
      <Body
        style={{
          background: BG,
          fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
          margin: 0,
          padding: '32px 0',
        }}
      >
        <Container style={{ maxWidth: 600, margin: '0 auto' }}>

          {/* Header */}
          <Section style={{ background: ACCENT, borderRadius: '12px 12px 0 0', padding: '28px 32px' }}>
            <Row>
              <Column>
                <Heading
                  as="h1"
                  style={{ color: '#fff', fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}
                >
                  ⚡ Changa Energy
                </Heading>
                <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, margin: '4px 0 0' }}>
                  Daily Solar Report · {date}
                </Text>
              </Column>
            </Row>
          </Section>

          {/* Fleet KPIs */}
          <Section style={{ background: SURFACE, padding: '24px 32px 20px' }}>
            <Text
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: TEXT_MUTED,
                textTransform: 'uppercase',
                letterSpacing: 1,
                margin: '0 0 16px',
              }}
            >
              Fleet Summary
            </Text>
            <Row>
              {(
                [
                  { value: `${summary.total_pv_kw.toFixed(1)} kW`, label: 'Live Output', color: ACCENT },
                  { value: `${summary.total_today_kwh.toFixed(1)} kWh`, label: "Today's Yield", color: '#F59E0B' },
                  { value: `${(summary.total_month_kwh / 1000).toFixed(1)} MWh`, label: 'Month Yield', color: '#3B82F6' },
                  {
                    value: String(summary.open_alarms),
                    label: 'Active Alarms',
                    color: summary.open_alarms > 0 ? '#EF4444' : ACCENT,
                  },
                ] as { value: string; label: string; color: string }[]
              ).map((kpi) => (
                <Column
                  key={kpi.label}
                  style={{
                    width: '25%',
                    textAlign: 'center',
                    padding: '12px 6px',
                    background: '#F8FAFC',
                    borderRadius: 8,
                  }}
                >
                  <Text style={{ fontSize: 20, fontWeight: 700, color: kpi.color, margin: 0 }}>
                    {kpi.value}
                  </Text>
                  <Text style={{ fontSize: 10, color: TEXT_SECONDARY, margin: '3px 0 0', fontWeight: 500 }}>
                    {kpi.label}
                  </Text>
                </Column>
              ))}
            </Row>
            <Text
              style={{ fontSize: 12, color: TEXT_SECONDARY, margin: '16px 0 0', textAlign: 'center' }}
            >
              {summary.online} online · {summary.alarm} in alarm · {summary.offline} offline · {summary.total} total
            </Text>
          </Section>

          <Hr style={{ borderColor: BORDER, margin: 0 }} />

          {/* Station table */}
          <Section style={{ background: SURFACE, padding: '20px 32px' }}>
            <Text
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: TEXT_MUTED,
                textTransform: 'uppercase',
                letterSpacing: 1,
                margin: '0 0 12px',
              }}
            >
              Station Breakdown · {stations.length} sites
            </Text>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#F8FAFC' }}>
                  {[
                    { label: 'Station', align: 'left' as const, pad: '8px 8px' },
                    { label: 'Status', align: 'center' as const, pad: '8px 6px' },
                    { label: 'Live kW', align: 'right' as const, pad: '8px 6px' },
                    { label: 'Today kWh', align: 'right' as const, pad: '8px 8px' },
                  ].map((col) => (
                    <th
                      key={col.label}
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: TEXT_MUTED,
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                        padding: col.pad,
                        textAlign: col.align,
                        borderBottom: `1px solid ${BORDER}`,
                      }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stations.map((st) => (
                  <tr key={st.name} style={{ borderBottom: `1px solid ${BORDER}` }}>
                    <td style={{ padding: '9px 8px', verticalAlign: 'middle' }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: TEXT_PRIMARY }}>{st.name}</div>
                      <div style={{ fontSize: 10, color: TEXT_MUTED, textTransform: 'uppercase', marginTop: 1 }}>
                        {st.source}
                      </div>
                    </td>
                    <td style={{ padding: '9px 6px', textAlign: 'center', verticalAlign: 'middle' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: statusColor(st.status) }}>
                        ● {statusLabel(st.status)}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: '9px 6px',
                        textAlign: 'right',
                        verticalAlign: 'middle',
                        fontSize: 12,
                        fontFamily: 'monospace',
                        color: TEXT_PRIMARY,
                      }}
                    >
                      {st.pv_power_kw != null ? st.pv_power_kw.toFixed(1) : '—'}
                    </td>
                    <td
                      style={{
                        padding: '9px 8px',
                        textAlign: 'right',
                        verticalAlign: 'middle',
                        fontSize: 12,
                        fontFamily: 'monospace',
                        color: TEXT_PRIMARY,
                      }}
                    >
                      {st.today_kwh != null ? st.today_kwh.toFixed(1) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Hr style={{ borderColor: BORDER, margin: 0 }} />

          {/* Alarms */}
          <Section style={{ background: SURFACE, padding: '20px 32px' }}>
            {alarms.length === 0 ? (
              <Text style={{ fontSize: 13, color: ACCENT, fontWeight: 500, margin: 0, textAlign: 'center' }}>
                ✓ No active alarms — all systems healthy
              </Text>
            ) : (
              <>
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: TEXT_MUTED,
                    textTransform: 'uppercase',
                    letterSpacing: 1,
                    margin: '0 0 12px',
                  }}
                >
                  Active Alarms · {alarms.length}
                </Text>
                {alarms.map((alarm, i) => (
                  <Row
                    key={i}
                    style={{
                      marginBottom: 8,
                      borderLeft: '3px solid #F59E0B',
                      paddingLeft: 12,
                      paddingTop: 8,
                      paddingBottom: 8,
                      background: '#fffbeb',
                      borderRadius: 4,
                    }}
                  >
                    <Column>
                      <Text style={{ fontSize: 12, fontWeight: 600, color: TEXT_PRIMARY, margin: 0 }}>
                        {alarm.station_name}
                      </Text>
                      <Text style={{ fontSize: 11, color: TEXT_SECONDARY, margin: '2px 0 0' }}>
                        {alarm.alarm_name ?? 'Unknown alarm'}
                        {alarm.severity && ` · ${alarm.severity}`}
                      </Text>
                      <Text style={{ fontSize: 10, color: TEXT_MUTED, margin: '2px 0 0' }}>
                        Raised{' '}
                        {new Date(alarm.raised_at).toLocaleString('en-ZA', {
                          timeZone: 'Africa/Johannesburg',
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        SAST
                      </Text>
                    </Column>
                  </Row>
                ))}
              </>
            )}
          </Section>

          {/* Footer */}
          <Section
            style={{ background: '#F1F5F9', borderRadius: '0 0 12px 12px', padding: '16px 32px' }}
          >
            <Text style={{ fontSize: 11, color: TEXT_MUTED, margin: 0, textAlign: 'center' }}>
              Generated {generatedAt} · Changa Energy Solar Dashboard
            </Text>
            <Text style={{ fontSize: 10, color: TEXT_MUTED, margin: '3px 0 0', textAlign: 'center' }}>
              {summary.total} stations · {(summary.total_lifetime_kwh / 1000).toFixed(1)} MWh lifetime generation
            </Text>
          </Section>

        </Container>
      </Body>
    </Html>
  );
}

export default DailyReport;

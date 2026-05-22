import {
  combineSeverity,
  describeWeatherCode,
} from '../../../src/domains/weather/weatherCodes';

describe('describeWeatherCode', () => {
  it('maps 0 to Limpo / ok', () => {
    const r = describeWeatherCode(0);
    expect(r.label).toBe('Limpo');
    expect(r.severity).toBe('ok');
  });

  it('maps 2 to Nublado / ok', () => {
    const r = describeWeatherCode(2);
    expect(r.label).toBe('Nublado');
    expect(r.severity).toBe('ok');
  });

  it('maps 45 / 48 to Neblina / warning', () => {
    expect(describeWeatherCode(45).label).toBe('Neblina');
    expect(describeWeatherCode(45).severity).toBe('warning');
    expect(describeWeatherCode(48).label).toBe('Neblina');
  });

  it('maps 51-57 to Garoa / warning', () => {
    expect(describeWeatherCode(51).label).toBe('Garoa');
    expect(describeWeatherCode(51).severity).toBe('warning');
    expect(describeWeatherCode(55).severity).toBe('warning');
  });

  it('maps 61 to Chuva / warning', () => {
    const r = describeWeatherCode(61);
    expect(r.label).toBe('Chuva');
    expect(r.severity).toBe('warning');
  });

  it('escalates 65 / 67 (heavy rain) to danger', () => {
    expect(describeWeatherCode(65).label).toBe('Chuva+');
    expect(describeWeatherCode(65).severity).toBe('danger');
    expect(describeWeatherCode(67).severity).toBe('danger');
  });

  it('maps 71-77 (neve) to danger', () => {
    expect(describeWeatherCode(71).label).toBe('Neve');
    expect(describeWeatherCode(71).severity).toBe('danger');
    expect(describeWeatherCode(75).severity).toBe('danger');
  });

  it('maps 80 / 81 to short shower label / warning', () => {
    expect(describeWeatherCode(80).label).toBe('Tempo.');
    expect(describeWeatherCode(80).severity).toBe('warning');
    expect(describeWeatherCode(81).severity).toBe('warning');
  });

  it('escalates 82 (violent showers) to danger', () => {
    expect(describeWeatherCode(82).label).toBe('Tempo.+');
    expect(describeWeatherCode(82).severity).toBe('danger');
  });

  it('maps 95-99 to Trovoada / danger', () => {
    expect(describeWeatherCode(95).label).toBe('Trovoada');
    expect(describeWeatherCode(95).severity).toBe('danger');
    expect(describeWeatherCode(96).severity).toBe('danger');
    expect(describeWeatherCode(99).severity).toBe('danger');
  });

  it('falls back to em-dash for unknown codes', () => {
    const r = describeWeatherCode(123);
    expect(r.label).toBe('—');
    expect(r.severity).toBe('ok');
  });
});

describe('combineSeverity', () => {
  it('passes through base severity when wind/precip are calm', () => {
    expect(combineSeverity(0, 5, 0)).toBe('ok');
    expect(combineSeverity(61, 5, 0)).toBe('warning');
  });

  it('escalates to danger when wind > 50 km/h regardless of code', () => {
    expect(combineSeverity(0, 60, 0)).toBe('danger');
    expect(combineSeverity(2, 51, 0)).toBe('danger');
  });

  it('escalates to danger when precip > 5 mm', () => {
    expect(combineSeverity(61, 10, 8)).toBe('danger');
    expect(combineSeverity(80, 10, 6)).toBe('danger');
  });

  it('does not escalate when wind == 50 exactly', () => {
    expect(combineSeverity(0, 50, 0)).toBe('ok');
  });

  it('does not escalate when precip == 5 exactly', () => {
    expect(combineSeverity(61, 10, 5)).toBe('warning');
  });
});

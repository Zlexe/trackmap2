import DATALENS_CONFIG from '../config/datalens';

export function Lens() {
  return (
    <section className="lens-page">
      <header className="page-header">
        <div className="page-header__copy">
          <span className="page-header__eyebrow">Аналитическая панель</span>
          <h1>Контроль отказов технических средств</h1>
        </div>
      </header>

      <div className="lens-frame">
        <iframe
          frameBorder="0"
          scrolling="auto"
          width="100%"
          height="100%"
          src={DATALENS_CONFIG.failuresDashboard}
          title="DataLens Dashboard - Отказы ОТС и ALSN"
        />
      </div>
    </section>
  );
}

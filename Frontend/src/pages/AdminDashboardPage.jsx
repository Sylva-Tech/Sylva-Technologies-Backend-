function AdminDashboardPage() {
  const cards = [
    { title: 'Orders', value: '24', detail: 'Awaiting fulfillment' },
    { title: 'Revenue', value: '$18.4k', detail: 'This month' },
    { title: 'Customers', value: '1,284', detail: 'Active accounts' },
  ];

  return (
    <section className="container section-block dashboard-shell">
      <div className="section-head">
        <h2>Admin Dashboard</h2>
      </div>

      <div className="dashboard-grid">
        {cards.map((card) => (
          <div key={card.title} className="dashboard-card">
            <h3>{card.title}</h3>
            <p style={{ fontSize: '2rem', fontWeight: 800, color: '#0d7d53' }}>{card.value}</p>
            <p>{card.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default AdminDashboardPage;
<template>
  <section class="home-view">
    <p class="eyebrow">RENTAL MANAGEMENT</p>
    <h1>Welcome</h1>
    <p class="intro">
      This is the management homepage. From here you can access bookings and
      other application features.
    </p>
    <div class="welcome-card">
      <h2>Your workspace</h2>
      <p>
        The homepage is ready to host the most important information and
        activities. Descriptive content and summaries will be added later.
      </p>
    </div>
  </section>
</template>

<style scoped>
.home-view {
  max-width: 920px;
  padding: 40px;
}

.eyebrow {
  margin: 0 0 10px;
  color: #2563eb;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
}

h1 {
  margin: 0;
  color: #111827;
  font-size: 32px;
}

.intro {
  max-width: 640px;
  margin: 12px 0 32px;
  color: #6b7280;
  font-size: 16px;
}

.welcome-card {
  padding: 26px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
}

.welcome-card h2 {
  margin: 0 0 8px;
  color: #1f2937;
  font-size: 18px;
}

.welcome-card p {
  margin: 0;
  color: #6b7280;
}

@media (max-width: 600px) {
  .home-view {
    padding: 26px 20px;
  }
}
</style>

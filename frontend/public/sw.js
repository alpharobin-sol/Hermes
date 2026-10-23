// Hermes service worker: shows the alerts Hermes sends for the routes this device watches
self.addEventListener("push", (event) => {
  if (!event.data) return
  let data = {}
  try {
    data = event.data.json()
  } catch {
    data = { title: "Hermes", body: event.data.text() }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Hermes", {
      body: data.body || "",
      icon: "/brand/icon-192.png",
      badge: "/brand/favicon-32.png",
      data: { url: data.url || "/" },
    })
  )
})

// Open Hermes, or focus it if it is already open
self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || "/"
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ("focus" in client) return client.focus()
      }
      return self.clients.openWindow(url)
    })
  )
})

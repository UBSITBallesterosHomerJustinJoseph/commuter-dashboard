import { AfterViewInit, Component, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import 'leaflet-control-geocoder';

import {
  Firestore,
  collection,
  collectionData,
  addDoc,
  query,
  orderBy
} from '@angular/fire/firestore';

import { Auth, onAuthStateChanged, signOut } from '@angular/fire/auth';
import { Subscription } from 'rxjs';
import { RouterModule } from '@angular/router';
import { Router } from '@angular/router';

@Component({
  selector: 'app-commuter-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './commuter.html',
  styleUrls: ['./commuter.css']
})
export class Commuter implements AfterViewInit, OnDestroy {

  // Top bar user system
  userName: string | null = null;
  customUsername: string = '';
  showSettings = false;

accountDropdownOpen = false;

toggleAccountDropdown() {
  this.accountDropdownOpen = !this.accountDropdownOpen;
}

closeAccountDropdown() {
  this.accountDropdownOpen = false;
}


  // Chat
  showChatDashboard = false;
  chatMessages: string[] = [];
  chatText = '';

  toggleChat() {
    this.showChatDashboard = !this.showChatDashboard;
  }

  sendChat() {
    if (this.chatText.trim() === '') return;
    this.chatMessages.push(this.chatText);
    this.chatText = '';
  }

  // Dashboard static fields (still available if you need them)
  route = 'Route 5: Downtown to Uptown';
  delay = '10 min';
  delayTime = '08:30 AM';
  mapUrl = 'https://via.placeholder.com/400x200?text=Route+Map';
  nextBusTime = '08:45 AM';
  nextBusDestination = 'Central Station';

  // Map
  map!: L.Map;
  marker: L.Marker | null = null;
  circle: L.Circle | null = null;
  radius = 1500;
  lat = '—';
  lng = '—';

  // Jeepneys
  private jeepMarkers = new Map<string, L.Marker>();
  private jeepIcon: L.Icon;

  // nearest
 nearestJeepneys: any[] = [];


  // Community
  newPostText = '';
  communityPosts: any[] = [];

  jeepSub: Subscription | null = null;
  communitySub: Subscription | null = null;

  // Tools panel
  showTools = false;
  toggleTools() {
    this.showTools = !this.showTools;
  }

  constructor(
    private firestore: Firestore,
    private auth: Auth,
    private router: Router
  ) {
    // Read logged-in user
    onAuthStateChanged(this.auth, (user) => {
      const saved = localStorage.getItem('customUsername');

      if (saved) {
        this.customUsername = saved;
        this.userName = saved;
      } else if (user) {
        this.userName = user.displayName || user.email || 'User';
        this.customUsername = this.userName;
      } else {
        this.userName = 'Guest';
        this.customUsername = 'Guest';
      }
    });

    // Jeepney icon
    this.jeepIcon = L.icon({
      iconUrl: 'jeepney.png',
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -12]
    });
  }

  // ===== Settings modal actions =====
openSettings() {
  this.closeAccountDropdown();
  this.showSettings = true;
}
  closeSettings() { this.showSettings = false; }

  logout() {
    signOut(this.auth).then(() => {
      alert('Logged out successfully!');
      window.location.href = '/login';
    });
  }

  // ===== Lifecycle =====
  ngAfterViewInit() {
    this.initMap();
    this.listenJeepneysRealtime();
    this.loadCommunityRealtime();
  }

  ngOnDestroy() {
    this.jeepSub?.unsubscribe();
    this.communitySub?.unsubscribe();
    try { this.map?.off(); this.map?.remove(); } catch {}
  }

  // ===== Map =====
  private initMap() {
    this.map = L.map('map', {
      center: [16.417644, 120.601387],
      zoom: 14,
      zoomControl: false
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(this.map);

   
    const center = this.map.getCenter();
    this.createMarkerAndCircle(center.lat, center.lng, this.radius);

    this.map.on('click', (e: any) => {
      this.setMarkerAndCircle(e.latlng.lat, e.latlng.lng);
      this.evaluateNearest();
    });
  }

  private createMarkerAndCircle(lat: number, lng: number, radius = 500) {
    if (this.marker) this.marker.remove();
    if (this.circle) this.circle.remove();

    this.marker = L.marker([lat, lng], { draggable: true }).addTo(this.map);
    this.circle = L.circle([lat, lng], { radius }).addTo(this.map);

    this.updateInfo(lat, lng, radius);

    this.marker.on('drag', (e: any) => {
      const p = e.target.getLatLng();
      this.circle?.setLatLng(p);
      this.updateInfo(p.lat, p.lng, this.circle?.getRadius() ?? this.radius);
      this.evaluateNearest();
    });

    this.marker.on('click', () => this.updateTooltip());
    this.circle.on('click', () => this.updateTooltip());
  }

  private updateInfo(lat: number, lng: number, radius: number) {
    this.lat = lat.toFixed(6);
    this.lng = lng.toFixed(6);
    this.radius = Math.round(radius);
  }

  updateRadiusFromUI() {
    if (this.circle) {
      const center = this.circle.getLatLng();
      const zoom = this.map.getZoom();

      this.circle.setRadius(Number(this.radius));
      this.map.setView(center, zoom);
    }
    this.evaluateNearest();
  }

  fitToCircle() {
    if (this.circle) this.map.fitBounds(this.circle.getBounds());
  }

  setMarkerAndCircle(lat: number, lng: number) {
    this.marker?.setLatLng([lat, lng]);
    this.circle?.setLatLng([lat, lng]);
    this.updateInfo(lat, lng, this.circle?.getRadius() ?? this.radius);
  }

  locateMe() {
    if (!navigator.geolocation) return alert('Geolocation not supported');
    navigator.geolocation.getCurrentPosition((pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      this.setMarkerAndCircle(lat, lng);
      this.map.setView([lat, lng], 15);
      this.evaluateNearest();
    });
  }

  private updateTooltip() {
    if (!this.marker || !this.circle) return;
    const p = this.marker.getLatLng();
    const r = this.circle.getRadius();
  }

  // ===== Jeepney realtime =====
  private listenJeepneysRealtime() {
    const col = collection(this.firestore, 'jeepneys');
    const q = query(col);

    this.jeepSub = collectionData(q, { idField: 'id' })
      .subscribe((items: any[]) => {
        this.updateJeepMarkers(items || []);
        this.evaluateNearest();
      });
  }

  private updateJeepMarkers(list: any[]) {
    const seen = new Set<string>();

    for (const j of list) {
      if (!j.id || !j.lat || !j.lng) continue;

      seen.add(j.id);
      const latlng: L.LatLngExpression = [j.lat, j.lng];

      if (this.jeepMarkers.has(j.id)) {
        const m = this.jeepMarkers.get(j.id)! as any;
        m.setLatLng(latlng);
        m.jeepData = { ...j };
        m.setPopupContent(this.jeepPopupContent(j));
      } else {
        const m = L.marker(latlng, { icon: this.jeepIcon }) as any;
        m.jeepData = { ...j };
        m.bindPopup(this.jeepPopupContent(j));
        m.addTo(this.map);
        this.jeepMarkers.set(j.id, m);
      }
    }

    for (const id of Array.from(this.jeepMarkers.keys())) {
      if (!seen.has(id)) {
        const m = this.jeepMarkers.get(id)!;
        m.remove();
        this.jeepMarkers.delete(id);
      }
    }
  }

  private jeepPopupContent(j: any) {
    const speed = j.speed? (j.speed * 3.6).toFixed(1) + ' km/h': '—';
    const updated = j.updatedAt? new Date(j.updatedAt).toLocaleTimeString(): '—';
    const passengers = j.passengerCount ?? 0; // fallback to 0
    const capacity = j.capacity ?? 'N/A';

    return `
      <div class="jeep-popup">
        <div class="title">🛺 Jeepney ${j.plate || '—'}</div>
        <div><b>Route:</b> ${j.routeId || '—'}</div>
        <div><b>Speed:</b> ${speed}</div>
        <div><b>Passengers:</b> ${passengers} / ${capacity}</div>
        <div><b>Last update:</b> ${updated}</div>
      </div>
    `;
  }

  // ===== Nearest jeep =====
 private evaluateNearest() {
  if (!this.marker) return;

  const center = this.marker.getLatLng();
  const results: any[] = [];

  this.jeepMarkers.forEach((m, id) => {
    const jeepMarker = m as any;
    const p = jeepMarker.getLatLng();
    const data = jeepMarker.jeepData || {};

    const dist = this.distanceMeters(
      { lat: center.lat, lng: center.lng },
      { lat: p.lat, lng: p.lng }
    );

    const avgSpeedMps = (20 * 1000) / 3600;
    const etaMin = Math.ceil((dist / avgSpeedMps) / 60);

    results.push({
      id,
      plate: data.plate || '—',
      lat: p.lat,
      lng: p.lng,
      distance: Math.round(dist),
      eta: etaMin,
      passengerCount: data.passengerCount || 0, 
      capacity: data.capacity,
      marker: jeepMarker
    });
  });

  // Sort by distance
  results.sort((a, b) => a.distance - b.distance);

  // Get top 3 nearest
  this.nearestJeepneys = results.slice(0, 3);

  // Highlight only the nearest
  if (this.nearestJeepneys.length > 0) {
    this.highlightNearestMarker(this.nearestJeepneys[0].id);
  }
}


private highlightNearestMarker(id: string) {
  this.jeepMarkers.forEach((m, key) => {
    const el = m.getElement() as HTMLElement;

    if (!el) return;

    if (key === id) {
      m.setOpacity(1);

      // Highlight glow for nearest jeep
      el.classList.add('nearest-jeep-highlight');
    } else {
      m.setOpacity(0.5);
      el.classList.remove('nearest-jeep-highlight');
    }
  });
}




  // ===== Community =====
  private loadCommunityRealtime() {
    const colRef = collection(this.firestore, 'community');
    const q = query(colRef, orderBy('time', 'desc'));

    this.communitySub = collectionData(q, { idField: 'id' })
      .subscribe((posts: any[]) => {
        this.communityPosts = (posts || []).map(p => ({
          ...p,
          timeDisplay: p.time ? (new Date(p.time)).toLocaleString() : ''
        }));
      });
  }

  async sendPost() {
    const text = (this.newPostText || '').trim();
    if (!text) return;

    const postsRef = collection(this.firestore, 'community');
    await addDoc(postsRef, {
      user: this.customUsername || 'Anonymous',
      text,
      time: new Date().toISOString()
    });

    this.newPostText = '';
  }

  saveUsername() {
    const name = (this.customUsername || '').trim();
    if (!name) return alert('Username cannot be empty.');

    this.userName = name;
    localStorage.setItem('customUsername', name);

    alert('Username updated!');
  }

  // ===== Distance helpers =====
  private toRad(v: number) { return v * Math.PI / 180; }

  private haversineKm(a: { lat: number, lng: number }, b: { lat: number, lng: number }) {
    const R = 6371;
    const dLat = this.toRad(b.lat - a.lat);
    const dLon = this.toRad(b.lng - a.lng);
    const lat1 = this.toRad(a.lat);
    const lat2 = this.toRad(b.lat);

    const sinDlat = Math.sin(dLat / 2);
    const sinDlon = Math.sin(dLon / 2);
    const aa = sinDlat * sinDlat +
      Math.cos(lat1) * Math.cos(lat2) * sinDlon * sinDlon;

    return R * (2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa)));
  }

   private distanceMeters(a: { lat: number, lng: number }, b: { lat: number, lng: number }) {
    return this.haversineKm(a, b) * 1000;
  }

  // ===== Search bar (center pill) =====
  searchText = '';

  // Simple geocoding using Nominatim (OpenStreetMap)
  async runSearch() {
    const q = (this.searchText || '').trim();
    if (!q) return;

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}`;

    try {
      const res = await fetch(url);
      const data: any[] = await res.json();
      if (!data.length) {
        alert('No results found');
        return;
      }

      const best = data[0];
      const lat = parseFloat(best.lat);
      const lon = parseFloat(best.lon);

      this.setMarkerAndCircle(lat, lon);
      this.map.setView([lat, lon], 15);
      this.evaluateNearest();
    } catch (e) {
      console.error('Search error', e);
      alert('Search failed. Please try again.');
    }
  }
}  // <== end of Commuter class

// Enable popup close button to work (if used)
(window as any).closeLeafletPopup = () => {
  const map = (window as any).leafletMapRef;
  if (map) map.closePopup();
};

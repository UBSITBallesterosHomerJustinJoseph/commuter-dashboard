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
import { RouterLink, RouterModule } from '@angular/router';
import { Router } from '@angular/router';
@Component({
  selector: 'app-commuter-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule,RouterModule,RouterLink],
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

showChat = false;
chatMessages: string[] = [];
chatText = "";



sendChat() {
  if (this.chatText.trim() === "") return;
  this.chatMessages.push(this.chatText);
  this.chatText = "";
}


showChatDashboard = false;

toggleChat() {
  this.showChatDashboard = !this.showChatDashboard;
}


  // Dashboard static fields
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
  nearestJeep: any = null;
  nearestDistanceMeters = 0;
  nearestEtaMinutes = 0;

  // Community
  newPostText = '';
  communityPosts: any[] = [];

  jeepSub: Subscription | null = null;
  communitySub: Subscription | null = null;

  constructor(private firestore: Firestore, private auth: Auth, private router: Router) {


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
  openSettings() { this.showSettings = true; }
  closeSettings() { this.showSettings = false; }

  // logout() {
  //   signOut(this.auth).then(() => {
  //     alert('Logged out successfully!');
  //     window.location.href = '/login';
  //   });
  // }
logout() {
  signOut(this.auth).then(() => {
    localStorage.removeItem('user');
    this.router.navigate(['/login']);
  });}

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

    // ADD NEW ZOOM BUTTONS inside the map bottom-left
    L.control.zoom({
      position: 'bottomleft'
    }).addTo(this.map);

    // Geocoder
    // @ts-ignore
    L.Control.geocoder({ defaultMarkGeocode: false, placeholder: 'Search places...' })
      .on('markgeocode', (e: any) => {
        const c = e.geocode.center;
        this.setMarkerAndCircle(c.lat, c.lng);
        this.map.fitBounds(e.geocode.bbox);
      })
      .addTo(this.map);

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
    this.marker.bindPopup(`
      <b>Marker info</b><br>
      Lat: ${p.lat.toFixed(6)}<br>
      Lng: ${p.lng.toFixed(6)}<br>
      Radius: ${Math.round(r)} m
    `).openPopup();
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
        m.jeepData = j; // attach full jeep data including plate
        m.setPopupContent(this.jeepPopupContent(j));
      } else {
        const m = L.marker(latlng, { icon: this.jeepIcon }) as any;
        m.jeepData = j; // attach full jeep data including plate
        m.bindPopup(this.jeepPopupContent(j));
        m.addTo(this.map);
        this.jeepMarkers.set(j.id, m);
      }
    }

    // Remove missing markers
    for (const id of Array.from(this.jeepMarkers.keys())) {
      if (!seen.has(id)) {
        const m = this.jeepMarkers.get(id)!;
        m.remove();
        this.jeepMarkers.delete(id);
      }
    }
  }

  private jeepPopupContent(j: any) {
    const speed = j.speed
      ? (j.speed * 3.6).toFixed(1) + ' km/h'
      : '—';

    const updated = j.updatedAt
      ? new Date(j.updatedAt).toLocaleTimeString()
      : '—';

    return `
      <div class="jeep-popup">
        <div class="title">🛺 Jeepney ${j.plate || '—'}</div>
        <div><b>Route:</b> ${j.routeId || '—'}</div>
        <div><b>Speed:</b> ${speed}</div>
        <div><b>Last update:</b> ${updated}</div>
      </div>
    `;
  }

  // ===== Nearest jeep =====
  private evaluateNearest() {
    if (!this.marker) return;

    const center = this.marker.getLatLng();
    let best: any = null;
    let bestDist = Infinity;

    this.jeepMarkers.forEach((m, id) => {
      const marker = m as any;
      const p = marker.getLatLng();
      const d = this.distanceMeters(
        { lat: center.lat, lng: center.lng },
        { lat: p.lat, lng: p.lng }
      );
      if (d < bestDist) {
        bestDist = d;
        const data = marker.jeepData || {};
        best = {
          id,
          plate: data.plate || '—',
          lat: p.lat,
          lng: p.lng,
          marker: m
        };
      }
    });

    if (!best) {
      this.nearestJeep = null;
      this.nearestDistanceMeters = 0;
      this.nearestEtaMinutes = 0;
      return;
    }

    const avgSpeedMps = (20 * 1000) / 3600;
    const etaMin = (bestDist / avgSpeedMps) / 60;

    this.nearestJeep = best;
    this.nearestDistanceMeters = Math.round(bestDist);
    this.nearestEtaMinutes = Math.ceil(etaMin);

    this.highlightNearestMarker(best.id);
  }

  private highlightNearestMarker(id: string) {
    this.jeepMarkers.forEach((m, key) => {
      m.setOpacity(key === id ? 1 : 0.5);
      if (key === id) m.openPopup();
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

  showTools = false; // hidden on load

  toggleTools() {
    this.showTools = !this.showTools;
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
}

// Enable popup close button to work
(window as any).closeLeafletPopup = () => {
  const map = (window as any).leafletMapRef;
  if (map) map.closePopup();
};



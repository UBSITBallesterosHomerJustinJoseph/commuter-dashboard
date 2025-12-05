import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Firestore, doc, setDoc } from '@angular/fire/firestore';
import { Router, RouterLink } from '@angular/router';
import { Auth, createUserWithEmailAndPassword } from '@angular/fire/auth';

@Component({
  selector: 'app-add-driver',
  standalone: true,
  templateUrl: './add-driver.html',
  styleUrl: './add-driver.css',
  imports: [CommonModule, FormsModule, RouterLink]
})
export class AddDriver {

  name = '';
  email = '';
  license = '';
  plate = '';
  password = '';
  capacity: number | null = null;


  constructor(
    private firestore: Firestore,
    private auth: Auth,
    private router: Router
  ) {}

  async createDriver() {
    if (!this.name || !this.email || !this.password) {
      alert("Name, Email, and Password are required.");
      return;
    }

    try {
      //  Create Auth Account
      const cred = await createUserWithEmailAndPassword(
        this.auth,
        this.email,
        this.password
      );
      const uid = cred.user.uid;

      //  Save data using UID as document ID
      const userRef = doc(this.firestore, `users/${uid}`);

      await setDoc(userRef, {
        uid: uid,
        name: this.name,
        email: this.email,
        license: this.license,
        plate: this.plate,
        role: 'driver',     
        status: 'approved',
        capacity: this.capacity,
        createdAt: new Date()
      });

      alert("Driver account created successfully!");
      this.router.navigate(['/admin']);

    } catch (err: any) {
      console.error(err);
      alert("Error: " + err.message);
    }
  }

}
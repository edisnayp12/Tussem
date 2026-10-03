import { dbInstance } from './services/firebaseService';
import { collection, getDocs } from 'firebase/firestore';
import { auth } from './services/firebaseService';
import { signInAnonymously } from 'firebase/auth';

async function check() {
  try {
    await signInAnonymously(auth);
    const usersCount = (await getDocs(collection(dbInstance, 'users'))).size;
    const productsCount = (await getDocs(collection(dbInstance, 'products'))).size;
    const salesCount = (await getDocs(collection(dbInstance, 'sales'))).size;
    console.log(`Users: ${usersCount}`);
    console.log(`Products: ${productsCount}`);
    console.log(`Sales: ${salesCount}`);
    process.exit(0);
  } catch (e) {
    console.error("DB Error:", e);
    process.exit(1);
  }
}
check();

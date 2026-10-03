import { dbInstance } from './services/firebaseService';
import { collection, getDocs, getCountFromServer } from 'firebase/firestore';

async function check() {
  try {
    const usersCount = await getCountFromServer(collection(dbInstance, 'users'));
    const productsCount = await getCountFromServer(collection(dbInstance, 'products'));
    const salesCount = await getCountFromServer(collection(dbInstance, 'sales'));
    console.log(`Users: ${usersCount.data().count}`);
    console.log(`Products: ${productsCount.data().count}`);
    console.log(`Sales: ${salesCount.data().count}`);
    process.exit(0);
  } catch (e) {
    console.error("DB Error:", e);
    process.exit(1);
  }
}
check();

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserProfile, setUserInfo, findOrCreateUser } from './api'
import { auth as firebaseAuth } from './firebase'
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth'

const defaultLocalUser: UserProfile = {
  uid: 'default_user',
  display_name: 'Default User',
  email: 'contact@pickle.com',
};

export const useAuth = () => {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [mode, setMode] = useState<'local' | 'firebase' | null>(null)
  
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, async (firebaseUser: FirebaseUser | null) => {
      if (firebaseUser) {
        // Firebase user is signed in. This is "Hosting Service Mode".
        console.log('🔥 Firebase 모드 활성화:', firebaseUser.uid);
        setMode('firebase');
        
        let profile: UserProfile = {
          uid: firebaseUser.uid,
          display_name: firebaseUser.displayName || 'User',
          email: firebaseUser.email || 'no-email@example.com',
        };
        
        // Firestore에 사용자 정보 생성/확인
        try {
          profile = await findOrCreateUser(profile);
          console.log('✅ Firestore 사용자 생성/확인 완료:', profile);
        } catch (error) {
          console.error('❌ Firestore 사용자 생성/확인 실패:', error);
        }

        setUser(profile);
        setUserInfo(profile);
        
        // Notify the Electron main process of the user change
        if (window.ipcRenderer) {
          window.ipcRenderer.send('set-current-user', profile.uid);
        }

      } else {
        // No user is signed in. Fallback to "Local Mode".
        console.log('🏠 로컬 모드 활성화');
        setMode('local');
        
        setUser(defaultLocalUser);
        setUserInfo(defaultLocalUser); // Sync with localStorage

        // Notify the Electron main process of the user change
        if (window.ipcRenderer) {
          window.ipcRenderer.send('set-current-user', defaultLocalUser.uid);
        }
      }
      setIsLoading(false);
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, [])

  return { user, isLoading, mode }
}

export const useRedirectIfNotAuth = () => {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    // This hook is now simplified. It doesn't redirect for local mode.
    // If you want to force login for hosting mode, you'd add logic here.
    // For example: if (!isLoading && !user) router.push('/login');
    // But for now, we allow both modes.
  }, [user, isLoading, router])

  return user
} 
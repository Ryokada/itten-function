import * as admin from 'firebase-admin';
import { Firestore } from 'firebase-admin/firestore';

export const getAnotherFirestore = () => {
    const anotherId = process.env.ANOTHER_FIREBASE_PROJECT_ID;
    if (!anotherId) {
        throw new Error('対象のプロジェクトID（ANOTHER_PROJECT_ID）が指定されていません');
    }

    return new Firestore({
        projectId: anotherId,
        // 予めFirebase側のIAMで、functionsのサービスアカウントに対して、権限を与えておく必要がある
        credential: admin.credential.applicationDefault(),
    });
};

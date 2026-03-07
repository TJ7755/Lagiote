import { bootstrapStudyApp } from '../../features/study/bootstrap.js';

bootstrapStudyApp().catch((error) => {
    console.error('Study bootstrap failed:', error);
});

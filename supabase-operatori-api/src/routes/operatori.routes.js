import { Router } from 'express';
import { listOperatori, getOperatore, creaOperatore, aggiornaOperatore, eliminaOperatore } from '../controllers/operatori.controller.js';

const router = Router();

router.get('/', listOperatori);
router.get('/:id', getOperatore);
router.post('/', creaOperatore);
router.put('/:id', aggiornaOperatore);
router.delete('/:id', eliminaOperatore);

export default router;

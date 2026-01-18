import express from 'express';
import * as usersController from '../controllers/users.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);
router.use(requireAdmin); // User management is strictly admin only

router.get('/', usersController.getAllUsers);
router.post('/', usersController.createUser);
router.put('/:id', usersController.updateUser);
router.delete('/:id', usersController.deleteUser);

export default router;

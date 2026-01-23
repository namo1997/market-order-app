import express from 'express';
import * as recipeController from '../controllers/recipe.controller.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);
router.use(requireAdmin);

router.get('/menus', recipeController.searchMenus);
router.get('/usage', recipeController.getUsageReport);
router.get('/', recipeController.getRecipes);
router.get('/:id', recipeController.getRecipeById);
router.post('/', recipeController.createRecipe);
router.delete('/:id', recipeController.deleteRecipe);
router.post('/:id/items', recipeController.addRecipeItem);
router.put('/items/:itemId', recipeController.updateRecipeItem);
router.delete('/items/:itemId', recipeController.deleteRecipeItem);

export default router;

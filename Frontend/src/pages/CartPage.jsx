import { Link } from 'react-router-dom';
import { useCart } from '../context/CartContext';

function CartPage() {
  const { cartItems, subtotal, updateQuantity, removeFromCart, clearCart } = useCart();

  if (cartItems.length === 0) {
    return (
      <section className="container section-block cart-empty">
        <h2>Your cart is empty</h2>
        <p>Add some products to continue shopping.</p>
        <Link to="/shop" className="primary-btn">Continue Shopping</Link>
      </section>
    );
  }

  return (
    <section className="container section-block cart-page">
      <h2>Your Cart</h2>
      <div className="cart-layout">
        <div className="cart-items">
          {cartItems.map((item) => (
            <div key={item._id} className="cart-item">
              <div className="cart-item-image">{item.brand || 'Item'}</div>
              <div className="cart-item-info">
                <h3>{item.name}</h3>
                <p>KSh {Number(item.price).toLocaleString()}</p>
                <div className="quantity-row">
                  <button onClick={() => updateQuantity(item._id, item.quantity - 1)}>-</button>
                  <span>{item.quantity}</span>
                  <button onClick={() => updateQuantity(item._id, item.quantity + 1)}>+</button>
                </div>
              </div>
              <div className="cart-item-actions">
                <strong>KSh {(item.price * item.quantity).toLocaleString()}</strong>
                <button className="remove-btn" onClick={() => removeFromCart(item._id)}>Remove</button>
              </div>
            </div>
          ))}
        </div>

        <aside className="cart-summary">
          <h3>Cart Summary</h3>
          <div className="summary-row">
            <span>Subtotal</span>
            <strong>KSh {subtotal.toLocaleString()}</strong>
          </div>
          <div className="summary-row">
            <span>Delivery</span>
            <strong>KSh 0</strong>
          </div>
          <div className="summary-row total">
            <span>Total</span>
            <strong>KSh {subtotal.toLocaleString()}</strong>
          </div>
          <Link to="/checkout" className="primary-btn full-btn checkout-link">Checkout</Link>
          <button className="secondary-btn full-btn" onClick={clearCart}>Clear Cart</button>
        </aside>
      </div>
    </section>
  );
}

export default CartPage;

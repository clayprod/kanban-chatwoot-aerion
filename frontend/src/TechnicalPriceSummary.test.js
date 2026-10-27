import React from 'react';import {render,screen} from '@testing-library/react';import '@testing-library/jest-dom';import TechnicalPriceSummary from './TechnicalPriceSummary';
test('explains base, extras, unit reference, unit difference and totals without double counting',()=>{
 render(<TechnicalPriceSummary item={{quantity:3}} product={{sale_price:110,price_comparison:{reference:150},configuration:{base_price:100,extra_price:10,additions:[{name:'Carregador',quantity:1,unit_price:10}]}}}/>);
 expect(screen.getByText(/Produto: R\$.*100,00.*complementos: R\$.*10,00/)).toBeVisible();expect(screen.getByText(/40,00 abaixo/)).toBeVisible();expect(screen.getByText(/1 × Carregador/)).toBeVisible();expect(screen.getByText('R$ 330,00',{exact:false})).toBeVisible();expect(screen.getByText(/Referência total do item: R\$.*450,00/)).toBeVisible();
});
test('a missing base price is not presented as a free product and unlike units are not compared',()=>{
 render(<TechnicalPriceSummary item={{reference_price:150}} product={{sale_price:0}}/>);expect(screen.getAllByText('Não informado').length).toBeGreaterThan(0);expect(screen.getByText('Comparação pendente')).toBeVisible();expect(screen.queryByText(/0,00 abaixo/)).not.toBeInTheDocument();
});

import 'regenerator-runtime/runtime';

const output = document.getElementById('block')


const getData = async () => {
    const res = await fetch ('https://jsonplaceholder.typicode.com/todos')
    const parsedRes = await res.json();
   
   output.innerHTML = parsedRes.map(({title, id}) =>
   { return `
   <div class="card"> ${id} </div>
   <p class="desc">${title}</p>`})
   
   
    //console.log (parsedRes);
    //document.body.innerHTML = `<h2>${parsedRes.original_title}</h2><p>${parsedRes.overview}</p>`
    return parsedRes;
}

getData ()

//console.log (getData);